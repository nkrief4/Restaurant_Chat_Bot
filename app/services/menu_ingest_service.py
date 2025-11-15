"""Utilities to convert uploaded menus into structured JSON documents."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import mimetypes
import re
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
    return payload


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
