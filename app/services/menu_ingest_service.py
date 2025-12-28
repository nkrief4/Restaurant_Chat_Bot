"""Utilities to convert uploaded menus into structured JSON documents."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import mimetypes
import re
import unicodedata
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Callable, Dict, Literal, Tuple

from pypdf import PdfReader

from app.config.openai_client import client

MenuKind = Literal["image", "pdf"]

SUPPORTED_EXTENSIONS: Dict[str, Tuple[str, MenuKind]] = {
    ".jpg": ("image/jpeg", "image"),
    ".jpeg": ("image/jpeg", "image"),
    ".png": ("image/png", "image"),
    ".webp": ("image/webp", "image"),
    ".gif": ("image/gif", "image"),
    ".bmp": ("image/bmp", "image"),
    ".tif": ("image/tiff", "image"),
    ".tiff": ("image/tiff", "image"),
    ".heic": ("image/heic", "image"),
    ".heif": ("image/heif", "image"),
    ".avif": ("image/avif", "image"),
    ".pdf": ("application/pdf", "pdf"),
}

SUPPORTED_MIME_MAP: Dict[str, Tuple[str, MenuKind]] = {
    "image/jpeg": ("image/jpeg", "image"),
    "image/jpg": ("image/jpeg", "image"),
    "image/png": ("image/png", "image"),
    "image/webp": ("image/webp", "image"),
    "image/gif": ("image/gif", "image"),
    "image/bmp": ("image/bmp", "image"),
    "image/tiff": ("image/tiff", "image"),
    "image/heic": ("image/heic", "image"),
    "image/heif": ("image/heif", "image"),
    "image/avif": ("image/avif", "image"),
    "application/pdf": ("application/pdf", "pdf"),
}

MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB ceiling to keep latency reasonable.
MAX_PDF_TEXT_CHARS = 15000
MENU_EXTRACTION_MODEL = "gpt-4.1-mini"
MENU_VISION_MODEL = "gpt-4o-mini"
TOKEN_BUDGETS = (10000,)

SYSTEM_INSTRUCTIONS = (
    "Tu reçois la carte d'un restaurant et tu dois produire un JSON structuré. "
    "Réponds UNIQUEMENT avec du JSON valide, sans texte autour. "
    "Le format attendu est : {\"categories\": [{\"name\": str, \"items\": [{\"name\": str, \"price\": float | str, \"description\": str, \"tags\": [str], \"contains\": [str]}]}], "
    "\"dietaryGuide\": [{\"label\": str, \"items\": [str]}] }. "
    "Utilise la langue dominante du menu (ex: espagnol, anglais) pour les champs textuels; sinon réponds en français. "
    "Utilise l'euro comme devise si aucune n'est précisée et conserve l'ordre logique du menu."
)

CODE_FENCE_PATTERN = re.compile(r"```(json)?(.*?)```", re.DOTALL | re.IGNORECASE)
logger = logging.getLogger(__name__)

SYSTEM_PROMPT_MENU_PARSER = (
    "Tu es un expert en analyse de cartes de restaurants. "
    "Ignore tout décor, logos ou textes hors menu. "
    "Extrait uniquement les informations de menu et retourne STRICTEMENT un JSON correspondant à : "
    "{\"categories\": [{\"name\": str, \"items\": [{\"name\": str, \"description\": str, "
    "\"price\": float | str, \"tags\": [str], \"contains\": [str]}]}]}. "
    "Déduis les allergènes (champ 'contains') et les tags pertinents (ex: vegan, épicé, sans gluten) "
    "lorsque l'information est implicite. "
    "Aucun autre texte n'est autorisé : réponds uniquement avec un JSON valide."
)

DEFAULT_EMPTY_MENU: Dict[str, Any] = {"categories": []}


class MenuExtractionError(RuntimeError):
    """Raised when menu extraction fails."""


class TruncatedMenuResponse(MenuExtractionError):
    """Raised when the LLM stopped before closing the JSON payload."""


@dataclass(frozen=True)
class UploadMeta:
    filename: str
    mime_type: str
    kind: MenuKind


async def build_menu_document_from_upload(*, filename: str, content_type: str | None, data: bytes) -> Dict[str, Any]:
    """Return a structured menu_document parsed from an uploaded file."""

    if not data:
        raise MenuExtractionError("Le fichier envoyé est vide.")
    if len(data) > MAX_FILE_BYTES:
        raise MenuExtractionError("Le fichier dépasse la taille maximale autorisée (8 MB).")

    meta = _detect_upload_meta(filename, content_type)

    if meta.kind == "pdf":
        text = _extract_pdf_text(data)
        if not text.strip():
            raise MenuExtractionError("Impossible de lire le texte du PDF fourni.")
        request_callable = partial(_request_menu_from_text, text)
    else:
        image_b64 = base64.b64encode(data).decode("ascii")
        request_callable = partial(_request_menu_from_image, image_b64, meta.mime_type)

    return await _generate_menu_with_retries(request_callable)


async def _generate_menu_with_retries(request_callable: Callable[..., str]) -> Dict[str, Any]:
    """Call the provided completion function until JSON is complete or retries are exhausted."""

    last_truncation: TruncatedMenuResponse | None = None
    for budget in TOKEN_BUDGETS:
        completion_text = await asyncio.to_thread(request_callable, max_tokens=budget)
        logger.debug(
            "Menu extraction raw response (max_tokens=%s): %s",
            budget,
            _preview_text(completion_text, 600),
        )
        try:
            return _parse_menu_json(completion_text)
        except TruncatedMenuResponse as exc:
            last_truncation = exc
            logger.info(
                "Menu JSON truncated with token budget %s, retrying with a larger allowance.",
                budget,
            )
            continue

    if last_truncation is not None:
        raise last_truncation
    raise MenuExtractionError("Impossible de générer un menu complet après plusieurs tentatives.")


def _detect_upload_meta(filename: str, content_type: str | None) -> UploadMeta:
    lowered_mime = (content_type or "").lower()
    if lowered_mime in SUPPORTED_MIME_MAP:
        mime_type, kind = SUPPORTED_MIME_MAP[lowered_mime]
        return UploadMeta(filename=filename, mime_type=mime_type, kind=kind)

    if lowered_mime.startswith("image/"):
        return UploadMeta(filename=filename, mime_type=lowered_mime, kind="image")

    extension = Path(filename or "").suffix.lower()
    if extension in SUPPORTED_EXTENSIONS:
        mime_type, kind = SUPPORTED_EXTENSIONS[extension]
        return UploadMeta(filename=filename, mime_type=mime_type, kind=kind)

    guessed_mime, _ = mimetypes.guess_type(filename or "")
    if guessed_mime and guessed_mime.lower().startswith("image/"):
        return UploadMeta(filename=filename, mime_type=guessed_mime, kind="image")

    raise MenuExtractionError(
        "Format de fichier non pris en charge. Utilisez toute image (PNG, JPG, HEIC, WEBP...) ou un PDF."
    )


def _extract_pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:  # pragma: no cover - parsing depends on uploaded PDF
        raise MenuExtractionError("Impossible d'ouvrir le PDF : fichier corrompu ou chiffré.") from exc

    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # pragma: no cover - best effort per page
            continue
    combined = "\n".join(pages)
    if len(combined) > MAX_PDF_TEXT_CHARS:
        combined = combined[:MAX_PDF_TEXT_CHARS]
    return combined


def _request_menu_from_text(menu_text: str, *, max_tokens: int) -> str:
    completion = client.chat.completions.create(
        model=MENU_EXTRACTION_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_INSTRUCTIONS},
            {
                "role": "user",
                "content": (
                    "Analyse le texte suivant, qui correspond à un menu, et convertis-le en JSON.\n" f"{menu_text}"  # type: ignore[arg-type]
                ),
            },
        ],
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content or ""


def _request_menu_from_image(image_b64: str, mime_type: str, *, max_tokens: int) -> str:
    data_url = f"data:{mime_type};base64,{image_b64}"
    completion = client.chat.completions.create(
        model=MENU_VISION_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_INSTRUCTIONS},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Lis cette carte et convertis-la en JSON."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content or ""


def _parse_menu_json(raw_response: str) -> Dict[str, Any]:
    candidate = _strip_code_fences(raw_response)
    candidate = _extract_first_json_object(candidate)
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as exc:
        preview = _preview_text(candidate)
        logger.warning("Menu JSON parsing failed. preview=%s", preview)
        raise MenuExtractionError(
            "Le format JSON renvoyé par l'IA est invalide. Aperçu: " + preview
        ) from exc

    categories = payload.get("categories")
    if not isinstance(categories, list) or not categories:
        raise MenuExtractionError("Le JSON généré ne contient aucune catégorie.")
    return _normalize_menu_document(payload)


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower().strip()


def _normalize_tag(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, dict):
        candidate = value.get("label") or value.get("name") or value.get("value") or value.get("title")
    else:
        candidate = value
    if candidate is None:
        return None
    label = str(candidate).strip()
    if not label:
        return None
    return _normalize_text(label)


def _normalize_menu_document(menu: Dict[str, Any]) -> Dict[str, Any]:
    categories = menu.get("categories", [])
    if not isinstance(categories, list):
        return menu

    normalized_categories = []
    for category in categories:
        if not isinstance(category, dict):
            continue
        name = str(category.get("name") or "").strip() or "Autres"
        items = category.get("items") or []
        normalized_items = []
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                tags = []
                for tag in item.get("tags") or []:
                    normalized = _normalize_tag(tag)
                    if normalized:
                        tags.append(normalized)
                contains = []
                for allergen in item.get("contains") or []:
                    normalized = _normalize_tag(allergen)
                    if normalized:
                        contains.append(normalized)
                normalized_item = dict(item)
                normalized_item["tags"] = tags
                normalized_item["contains"] = contains
                normalized_items.append(normalized_item)
        normalized_categories.append({"name": name, "items": normalized_items})

    normalized_menu = dict(menu)
    normalized_menu["categories"] = normalized_categories

    dietary_guides = menu.get("dietaryGuide") or []
    normalized_guides = []
    if isinstance(dietary_guides, list):
        for entry in dietary_guides:
            if not isinstance(entry, dict):
                continue
            label = _normalize_tag(entry.get("label"))
            if not label:
                continue
            items = entry.get("items") or []
            normalized_items = [str(item).strip() for item in items if str(item).strip()]
            normalized_guides.append({"label": label, "items": normalized_items})
    if normalized_guides:
        normalized_menu["dietaryGuide"] = normalized_guides

    return normalized_menu


def _strip_code_fences(raw_text: str) -> str:
    if not raw_text:
        raise MenuExtractionError("L'IA n'a renvoyé aucun contenu.")
    text = raw_text.strip()
    match = CODE_FENCE_PATTERN.search(text)
    if match:
        text = match.group(2).strip()
    if text.lower().startswith("json"):
        text = text[4:].lstrip()
    return text


def _extract_first_json_object(text: str) -> str:
    """Best-effort extraction of the first balanced JSON object in the text."""

    start = text.find("{")
    if start == -1:
        raise MenuExtractionError("Impossible de trouver un objet JSON dans la réponse de l'IA.")

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    preview = _preview_text(text)
    logger.warning("Truncated JSON detected. preview=%s", preview)
    raise TruncatedMenuResponse(
        "La réponse de l'IA semble tronquée : JSON incomplet. Aperçu: " + preview
    )


def _preview_text(text: str, limit: int = 280) -> str:
    safe = (text or "").replace("\n", " ").strip()
    if len(safe) <= limit:
        return safe
    return safe[: limit - 3] + "..."


async def analyze_menu_image(image_bytes: bytes) -> Dict[str, Any]:
    """Use GPT-4o vision to convert a menu photo into structured JSON."""
    if not image_bytes:
        return DEFAULT_EMPTY_MENU.copy()

    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{image_b64}"

    try:
        completion = await asyncio.to_thread(
            client.chat.completions.create,
            model="gpt-4o",
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_MENU_PARSER},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyse cette photo de menu et fournis le JSON demandé."},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        )
        content = completion.choices[0].message.content or ""
        payload = json.loads(content)
        if isinstance(payload, dict):
            return _normalize_menu_document(payload)
        return DEFAULT_EMPTY_MENU.copy()
    except json.JSONDecodeError as exc:
        logger.error("Menu parser JSON invalide: %s", exc)
    except Exception as exc:  # pragma: no cover - network/service issues
        logger.error("Menu parser API error: %s", exc, exc_info=True)

    return DEFAULT_EMPTY_MENU.copy()


def merge_menu_documents(*documents: Dict[str, Any]) -> Dict[str, Any]:
    """Merge multiple menu documents into a single document.
    
    Categories with the same name will have their items combined.
    The order of categories follows the order of documents provided.
    """
    if not documents:
        raise MenuExtractionError("Aucun document de menu à fusionner.")
    
    # Filter out None/empty documents
    valid_docs = [doc for doc in documents if doc and isinstance(doc, dict)]
    if not valid_docs:
        raise MenuExtractionError("Aucun document de menu valide à fusionner.")
    
    if len(valid_docs) == 1:
        return _normalize_menu_document(valid_docs[0])
    
    merged_categories = []
    category_map = {}  # Track categories by name for merging
    
    # Merge categories from all documents
    for doc in valid_docs:
        categories = doc.get("categories", [])
        if not isinstance(categories, list):
            continue
            
        for category in categories:
            if not isinstance(category, dict):
                continue
                
            cat_name = category.get("name", "")
            if not cat_name:
                continue
            
            # If category already exists, merge items
            if cat_name in category_map:
                existing_cat = category_map[cat_name]
                existing_items = existing_cat.get("items", [])
                new_items = category.get("items", [])
                
                if isinstance(existing_items, list) and isinstance(new_items, list):
                    existing_cat["items"] = existing_items + new_items
            else:
                # New category, add it
                category_copy = {
                    "name": cat_name,
                    "items": category.get("items", [])
                }
                category_map[cat_name] = category_copy
                merged_categories.append(category_copy)
    
    # Merge dietary guides
    merged_dietary_guide = []
    dietary_map = {}
    
    for doc in valid_docs:
        dietary_guide = doc.get("dietaryGuide", [])
        if not isinstance(dietary_guide, list):
            continue
            
        for guide_entry in dietary_guide:
            if not isinstance(guide_entry, dict):
                continue
                
            label = guide_entry.get("label", "")
            if not label:
                continue
            
            items = guide_entry.get("items", [])
            if not isinstance(items, list):
                continue
            
            if label in dietary_map:
                # Merge items, avoiding duplicates
                existing_items = dietary_map[label].get("items", [])
                for item in items:
                    if item not in existing_items:
                        existing_items.append(item)
            else:
                guide_copy = {
                    "label": label,
                    "items": items.copy() if isinstance(items, list) else []
                }
                dietary_map[label] = guide_copy
                merged_dietary_guide.append(guide_copy)
    
    result = {
        "categories": merged_categories
    }
    
    if merged_dietary_guide:
        result["dietaryGuide"] = merged_dietary_guide
    
    return _normalize_menu_document(result)


async def build_menu_document_from_multiple_uploads(
    files: list[tuple[str, str | None, bytes]]
) -> Dict[str, Any]:
    """Build a menu document from multiple uploaded files.
    
    Args:
        files: List of tuples (filename, content_type, data) for each file
        
    Returns:
        Merged menu document
        
    Raises:
        MenuExtractionError: If no files provided or all files fail to process
    """
    if not files:
        raise MenuExtractionError("Aucun fichier fourni.")
    
    if len(files) > 5:
        raise MenuExtractionError("Vous ne pouvez pas uploader plus de 5 fichiers à la fois.")
    
    documents = []
    errors = []
    
    for idx, (filename, content_type, data) in enumerate(files, 1):
        try:
            logger.info("Processing file %d/%d: %s", idx, len(files), filename)
            doc = await build_menu_document_from_upload(
                filename=filename,
                content_type=content_type,
                data=data
            )
            documents.append(doc)
        except MenuExtractionError as exc:
            error_msg = f"{filename}: {str(exc)}"
            errors.append(error_msg)
            logger.warning("Failed to process file %s: %s", filename, exc)
        except Exception as exc:
            error_msg = f"{filename}: Erreur inattendue"
            errors.append(error_msg)
            logger.exception("Unexpected error processing file %s", filename)
    
    if not documents:
        error_summary = "; ".join(errors) if errors else "Tous les fichiers ont échoué."
        raise MenuExtractionError(f"Impossible d'analyser les fichiers. {error_summary}")
    
    # If some files failed but we have at least one success, log warnings
    if errors:
        logger.warning("Some files failed to process: %s", "; ".join(errors))
    
    # Merge all successfully processed documents
    return merge_menu_documents(*documents)
