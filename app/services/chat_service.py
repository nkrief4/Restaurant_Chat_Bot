"""Chat service responsible for calling OpenAI with menu context."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import hashlib
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypedDict

import unicodedata

from openai import APIError
from langdetect import DetectorFactory, LangDetectException, detect

from app.config.openai_client import client


logger = logging.getLogger(__name__)


class ChatMessage(TypedDict):
    role: str
    content: str


def _normalize_dietary_label(value: Any) -> Optional[str]:
    """Return a human readable dietary/allergen label."""

    if value is None:
        return None
    if isinstance(value, str):
        label = value.strip()
    elif isinstance(value, dict):
        label = (
            value.get("label")
            or value.get("name")
            or value.get("value")
            or value.get("title")
        )
        label = label.strip() if isinstance(label, str) else None
    else:
        label = str(value).strip()
    if not label:
        return None
    return label


def _add_dietary_entry(
    index: Dict[str, List[str]],
    canonical_labels: Dict[str, str],
    label: str,
    entry: str,
) -> None:
    """Store the entry under a normalized label while keeping readable text."""

    normalized = label.lower()
    canonical = canonical_labels.setdefault(normalized, label)
    bucket = index.setdefault(canonical, [])
    if entry not in bucket:
        bucket.append(entry)


def _build_dietary_index(menu_data: Dict[str, Any]) -> Dict[str, List[str]]:
    """Create a quick lookup of tags/allergens -> list of dish names with category."""

    index: Dict[str, List[str]] = {}
    canonical_labels: Dict[str, str] = {}

    for category in menu_data.get("categories", []):
        category_name = category.get("name", "Autres")
        for item in category.get("items", []):
            entry = f"{item.get('name', 'Plat')} ({category_name})"

            raw_tags = item.get("tags") or []
            for raw_tag in raw_tags:
                label = _normalize_dietary_label(raw_tag)
                if label:
                    _add_dietary_entry(index, canonical_labels, label, entry)

            allergens = item.get("contains") or []
            for allergen in allergens:
                label = _normalize_dietary_label(allergen)
                if label:
                    _add_dietary_entry(index, canonical_labels, label, entry)

    dietary_guides = menu_data.get("dietaryGuide") or []
    for guide in dietary_guides:
        if not isinstance(guide, dict):
            continue
        label = _normalize_dietary_label(guide.get("label"))
        if not label:
            continue
        items = guide.get("items") or []
        for dish_name in items:
            normalized_name = _normalize_dietary_label(dish_name)
            if not normalized_name:
                continue
            _add_dietary_entry(index, canonical_labels, label, normalized_name)

    return index


MAX_HISTORY_MESSAGES = 12
MAX_RECENT_MESSAGES = 6
MAX_SUMMARY_MESSAGES = 3
MAX_SUMMARY_CHARS_PER_MESSAGE = 160
MAX_ITEMS_PER_CATEGORY = 12
MAX_FALLBACK_CATEGORIES = 2
MAX_MENU_CONTEXT_CHARS = int(os.getenv("RAG_MAX_MENU_CONTEXT_CHARS", "9000"))
MIN_MENU_CONTEXT_CHARS = int(os.getenv("RAG_MIN_MENU_CONTEXT_CHARS", "2500"))
MAX_EMBEDDING_ITEMS = int(os.getenv("RAG_MAX_EMBEDDING_ITEMS", "120"))
MAX_CACHE_ENTRIES = int(os.getenv("RAG_MAX_CACHE_ENTRIES", "128"))
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-3-small")
ENABLE_EMBEDDINGS = os.getenv("RAG_EMBEDDINGS_ENABLED", "true").lower() in {"1", "true", "yes"}
STOPWORDS = {
    "a",
    "alors",
    "au",
    "aux",
    "avec",
    "ce",
    "ces",
    "de",
    "des",
    "du",
    "et",
    "je",
    "la",
    "le",
    "les",
    "me",
    "mon",
    "ma",
    "mes",
    "ou",
    "pour",
    "que",
    "qui",
    "quoi",
    "sur",
    "tu",
    "un",
    "une",
    "vos",
    "votre",
    "vous",
    "y",
}

DetectorFactory.seed = 0  # make language detection deterministic

DEFAULT_LANGUAGE_CODE = "fr"
DEFAULT_ERROR_MESSAGE = (
    "Je suis navré, je rencontre une difficulté momentanée pour consulter le menu. "
    "Pouvez-vous reformuler ?"
)

LANGUAGE_LABELS = {
    "ar": "arabe",
    "de": "allemand",
    "en": "anglais",
    "es": "espagnol",
    "fr": "français",
    "he": "hébreu",
    "it": "italien",
    "pt": "portugais",
    "ru": "russe",
    "zh-cn": "chinois simplifié",
    "zh-tw": "chinois traditionnel",
}


SYSTEM_PROMPT_TEMPLATE = (
    "Tu es l'assistant virtuel officiel du restaurant {restaurant_name}. "
    "Ta seule mission est de répondre aux questions sur ce restaurant : menu, ingrédients, régimes alimentaires, horaires, coordonnées et suggestions d'accompagnements issus des données ci-dessous. "
    "Refuse toute autre demande (actualité, météo, calculs, conversations générales) en expliquant calmement que tu ne peux parler que du restaurant. "
    "Tu connais les régimes végétarien, vegan/végétalien, halal, casher/kasher/kosher, sans porc, sans crustacé, sans gluten, sans lactose, allergies courantes, ainsi que toutes les contraintes présentes dans les tags/contains/dietaryGuide. "
    "Tu dois strictement rester dans les informations fournies par le menu, sans inventer de plats, d'ingrédients ou de prix. "
    "Quand un utilisateur impose un filtre (ex. sans fromage, sans gluten, casher, vegan), liste uniquement les plats compatibles, avec le format : \"• Nom (Catégorie) – Prix € – description/ingrédients\". "
    "Si rien ne correspond, dis-le clairement et propose poliment de reformuler. "
    "Rédige dans la langue détectée ({user_language_label}) avec des phrases courtes, sans blabla inutile, ton poli et professionnel. Privilégie des sections 'Section : ...' avec des puces '•'. "
    "Tu peux suggérer un accompagnement ou une boisson qui s'accorde bien avec un plat, mais uniquement si cette boisson est explicitement présente dans les données du menu. "
    "Si aucune boisson n'est disponible dans les données, dis-le clairement et ne propose aucune boisson générique. "
    "Ne récapitule pas l'intégralité du menu ; concentre-toi sur la question posée et les données utiles. "
    "Si la personne demande des précisions sur un ingrédient rare ou un poisson, donne une description culinaire brève et précise si le menu contient des plats pertinents. "
    "Si on te pousse à sortir du cadre ou à inventer, tu rappelles que tu dois respecter les données disponibles. "
    "La personne s'exprime en {user_language_label}. Réponds strictement dans cette langue.\n\n"
    "Contraintes actives de l'utilisateur (a appliquer en priorite) :\n{dietary_constraints}\n\n"
    "Resume de contexte recent :\n{conversation_summary}\n\n"
    "Référentiel interne sur les régimes alimentaires :\n{dietary_reference}\n\n"
    "Données complètes du menu (issues de la base de données, JSON):\n{menu_context}\n\n"
    "Index des régimes (tag -> plats):\n{dietary_context}"
)

DIETARY_REFERENCE = (
    "- Régime végétarien : exclut toutes les viandes, poissons et fruits de mer, mais les œufs et produits laitiers sont généralement acceptés.\n"
    "- Régime vegan/végétalien : exclut absolument tout produit d'origine animale (viandes, poissons, œufs, lait, miel, gélatine, etc.).\n"
    "- Régime halal : aliments permis selon la loi islamique, aucune viande de porc ni sous-produit, alcool interdit, viandes autorisées doivent provenir d'un abattage halal.\n"
    "- Régime casher/kasher : respecte les lois juives, aucune viande de porc ni crustacé, séparation stricte viande/lait, viandes autorisées issues d'animaux ruminants abattus rituellement.\n"
    "- Si un plat n'est pas compatible avec le régime demandé, il doit être exclu du résultat et il faut expliquer qu'il n'est pas autorisé."
)


def _build_system_prompt(
    restaurant_name: str,
    menu_document: Dict[str, Any],
    user_language_label: str,
    dietary_constraints: str,
    conversation_summary: str,
) -> str:
    safe_name = restaurant_name.strip() or "ce restaurant"
    menu_context = json.dumps(menu_document, ensure_ascii=False)
    dietary_index = _build_dietary_index(menu_document)
    dietary_context = json.dumps(dietary_index, ensure_ascii=False, indent=2)
    return SYSTEM_PROMPT_TEMPLATE.format(
        restaurant_name=safe_name,
        menu_context=menu_context,
        dietary_context=dietary_context,
        user_language_label=user_language_label,
        dietary_reference=DIETARY_REFERENCE,
        dietary_constraints=dietary_constraints,
        conversation_summary=conversation_summary,
    )


def _request_completion(messages: Sequence[ChatMessage], system_prompt: str) -> str:
    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            *messages,
        ],
    )
    if completion.choices:
        reply = completion.choices[0].message.content
        return reply or DEFAULT_ERROR_MESSAGE
    return DEFAULT_ERROR_MESSAGE


def _prepare_history(history: Optional[Sequence[ChatMessage]]) -> List[ChatMessage]:
    """Return only the latest relevant messages with safe roles/content."""
    if not history:
        return []

    cleaned: List[ChatMessage] = []
    for message in history[-MAX_HISTORY_MESSAGES:]:
        role = message.get("role")
        content = (message.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            cleaned.append({"role": role, "content": content})
    return cleaned[-MAX_HISTORY_MESSAGES:]


def _summarize_history(history: Sequence[ChatMessage]) -> str:
    """Create a short summary from older user messages."""

    if not history:
        return "- Aucun contexte additionnel."

    recent = MAX_RECENT_MESSAGES
    older = history[:-recent] if len(history) > recent else []
    if not older:
        return "- Aucun contexte additionnel."

    user_messages = [entry["content"] for entry in older if entry.get("role") == "user"]
    snippets = []
    for message in user_messages[:MAX_SUMMARY_MESSAGES]:
        cleaned = " ".join(message.split())
        if len(cleaned) > MAX_SUMMARY_CHARS_PER_MESSAGE:
            cleaned = f"{cleaned[:MAX_SUMMARY_CHARS_PER_MESSAGE - 1]}…"
        snippets.append(cleaned)

    if not snippets:
        return "- Aucun contexte additionnel."

    return "\n".join(f"- {snippet}" for snippet in snippets)


def _detect_user_language(user_message: str) -> Tuple[str, str]:
    cleaned = (user_message or "").strip()
    if not cleaned:
        return DEFAULT_LANGUAGE_CODE, LANGUAGE_LABELS[DEFAULT_LANGUAGE_CODE]
    try:
        code = detect(cleaned)
    except LangDetectException:
        code = DEFAULT_LANGUAGE_CODE
    label = LANGUAGE_LABELS.get(code, code)
    return code, label


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower()


def _tokenize(text: str) -> List[str]:
    tokens = [part for part in _normalize_text(text).split() if part]
    return [token for token in tokens if token not in STOPWORDS]


_MENU_FILTER_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_EMBEDDING_CACHE: "OrderedDict[str, List[float]]" = OrderedDict()


def _cache_get(cache: "OrderedDict[str, Any]", key: str) -> Optional[Any]:
    value = cache.get(key)
    if value is not None:
        cache.move_to_end(key)
    return value


def _cache_set(cache: "OrderedDict[str, Any]", key: str, value: Any) -> None:
    cache[key] = value
    cache.move_to_end(key)
    if len(cache) > MAX_CACHE_ENTRIES:
        cache.popitem(last=False)


def _menu_hash(menu_document: Dict[str, Any]) -> str:
    payload = json.dumps(menu_document, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _item_identifier(category_index: int, item: Dict[str, Any]) -> str:
    name = str(item.get("name") or "")
    description = str(item.get("description") or "")
    price = str(item.get("price") or "")
    raw = f"{category_index}:{name}:{description}:{price}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_item_text(category_name: str, item: Dict[str, Any]) -> str:
    parts = [
        category_name,
        str(item.get("name") or ""),
        str(item.get("description") or ""),
        " ".join(str(tag) for tag in (item.get("tags") or [])),
        " ".join(str(allergen) for allergen in (item.get("contains") or [])),
    ]
    return " ".join(part for part in parts if part).strip()


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _get_embeddings(texts: List[str]) -> Optional[List[List[float]]]:
    if not texts or not ENABLE_EMBEDDINGS:
        return None
    if len(texts) > MAX_EMBEDDING_ITEMS:
        return None
    try:
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    except APIError as exc:  # pragma: no cover - depends on network
        logger.warning("Embedding request failed: %s", exc)
        return None
    embeddings = []
    for entry in response.data:
        embeddings.append(entry.embedding)
    return embeddings


def _score_items(
    user_message: str,
    menu_document: Dict[str, Any],
) -> List[Tuple[float, int, Dict[str, Any]]]:
    categories = menu_document.get("categories", [])
    if not isinstance(categories, list):
        return []

    items: List[Tuple[int, Dict[str, Any], str]] = []
    for idx, category in enumerate(categories):
        category_name = str(category.get("name") or "")
        for item in category.get("items", []):
            items.append((idx, item, _build_item_text(category_name, item)))

    if not items:
        return []

    normalized_tokens = _tokenize(user_message)
    if ENABLE_EMBEDDINGS:
        user_embedding = None
        cached = _cache_get(_EMBEDDING_CACHE, f"query:{_normalize_text(user_message)}")
        if cached:
            user_embedding = cached
        else:
            embedding = _get_embeddings([user_message])
            if embedding:
                user_embedding = embedding[0]
                _cache_set(_EMBEDDING_CACHE, f"query:{_normalize_text(user_message)}", user_embedding)
        if user_embedding:
            scores = []
            for idx, item, text in items:
                cache_key = f"item:{_normalize_text(text)}"
                item_embedding = _cache_get(_EMBEDDING_CACHE, cache_key)
                if item_embedding is None:
                    embedding = _get_embeddings([text])
                    if embedding:
                        item_embedding = embedding[0]
                        _cache_set(_EMBEDDING_CACHE, cache_key, item_embedding)
                if item_embedding is None:
                    continue
                score = _cosine_similarity(user_embedding, item_embedding)
                scores.append((score, idx, item))
            if scores:
                return scores

    scores = []
    for idx, item, text in items:
        normalized_text = _normalize_text(text)
        score = sum(1 for token in normalized_tokens if token in normalized_text)
        if score > 0:
            scores.append((float(score), idx, item))
    return scores


def _dynamic_menu_budget(user_message: str, menu_document: Dict[str, Any]) -> int:
    menu_chars = len(json.dumps(menu_document, ensure_ascii=False))
    question_len = len(user_message or "")
    if menu_chars > MAX_MENU_CONTEXT_CHARS * 2:
        base = int(MAX_MENU_CONTEXT_CHARS * 0.7)
    elif menu_chars > MAX_MENU_CONTEXT_CHARS:
        base = int(MAX_MENU_CONTEXT_CHARS * 0.85)
    else:
        base = MAX_MENU_CONTEXT_CHARS
    penalty = min(2500, question_len * 8)
    return max(MIN_MENU_CONTEXT_CHARS, base - penalty)


def _apply_menu_budget(
    menu_document: Dict[str, Any],
    scored_items: List[Tuple[float, int, Dict[str, Any]]],
    *,
    budget_chars: int,
) -> Dict[str, Any]:
    menu_context = json.dumps(menu_document, ensure_ascii=False)
    if len(menu_context) <= budget_chars:
        return menu_document

    if not scored_items:
        return menu_document

    scores_sorted = sorted(scored_items, key=lambda entry: entry[0], reverse=True)
    categories = menu_document.get("categories", [])
    if not isinstance(categories, list):
        return menu_document

    max_items_total = min(len(scores_sorted), MAX_ITEMS_PER_CATEGORY * max(1, len(categories)))
    while max_items_total > 0:
        selected = scores_sorted[:max_items_total]
        selected_ids = {
            _item_identifier(category_index, item) for _, category_index, item in selected
        }
        filtered_categories = []
        for idx, category in enumerate(categories):
            items = category.get("items") or []
            if not isinstance(items, list):
                continue
            keep = []
            for item in items:
                if _item_identifier(idx, item) in selected_ids:
                    keep.append(item)
                if len(keep) >= MAX_ITEMS_PER_CATEGORY:
                    break
            if keep:
                trimmed = dict(category)
                trimmed["items"] = keep
                filtered_categories.append(trimmed)
        filtered = dict(menu_document)
        filtered["categories"] = filtered_categories
        if len(json.dumps(filtered, ensure_ascii=False)) <= budget_chars:
            return filtered
        max_items_total -= 5

    return menu_document

def _extract_dietary_constraints(messages: Sequence[ChatMessage]) -> str:
    """Extract persistent dietary constraints from user messages."""

    user_messages = [
        _normalize_text(message.get("content") or "")
        for message in messages
        if message.get("role") == "user"
    ]
    combined = " ".join(user_messages)
    if not combined:
        return "- Aucune contrainte explicite."

    rules = [
        ("sans fromage", ("sans fromage", "pas de fromage", "sans produits laitiers")),
        ("sans gluten", ("sans gluten", "gluten free")),
        ("sans lactose", ("sans lactose", "sans lait")),
        ("sans porc", ("sans porc", "pas de porc")),
        ("sans crustace", ("sans crustace", "pas de crustace", "fruits de mer")),
        ("vegetarien", ("vegetarien", "vegetarienne", "sans viande")),
        ("vegan", ("vegan", "vegetalien")),
        ("halal", ("halal",)),
        ("casher", ("casher", "kosher", "kasher")),
        ("allergie arachide", ("allergie arachide", "arachide", "cacahuete")),
        ("allergie noix", ("allergie noix", "noix")),
        ("allergie oeuf", ("allergie oeuf", "oeuf")),
        ("allergie poisson", ("allergie poisson", "poisson")),
    ]

    constraints = []
    for label, keywords in rules:
        if any(keyword in combined for keyword in keywords):
            constraints.append(label)

    if not constraints:
        return "- Aucune contrainte explicite."

    return "\n".join(f"- {constraint}" for constraint in sorted(set(constraints)))


def _merge_constraints(*blocks: Optional[str]) -> str:
    items: List[str] = []
    for block in blocks:
        if not block:
            continue
        for line in block.splitlines():
            cleaned = line.strip()
            if cleaned.startswith("- "):
                cleaned = cleaned[2:].strip()
            if cleaned and cleaned != "Aucune contrainte explicite.":
                items.append(cleaned)
    if not items:
        return "- Aucune contrainte explicite."
    return "\n".join(f"- {constraint}" for constraint in sorted(set(items)))


def _filter_menu_document(user_message: str, menu_document: Dict[str, Any]) -> Dict[str, Any]:
    """Filter the menu to only keep categories/items relevant to the user question."""

    message = user_message or ""
    normalized_message = _normalize_text(message)
    if not message:
        return menu_document

    cache_key = f"{_menu_hash(menu_document)}:{normalized_message}"
    cached = _cache_get(_MENU_FILTER_CACHE, cache_key)
    if cached:
        return cached

    categories = menu_document.get("categories", [])
    if not isinstance(categories, list):
        return menu_document

    def _has_beverage_category() -> bool:
        for category in categories:
            name = _normalize_text(str(category.get("name") or ""))
            if "boisson" in name or "drink" in name or "beverage" in name:
                return True
        return False

    if any(keyword in normalized_message for keyword in ("boisson", "drink", "beverage", "vin", "cocktail", "biere", "biere")):
        if not _has_beverage_category():
            safe_menu = dict(menu_document)
            safe_menu["categories"] = []
            return safe_menu

    message_tokens = _tokenize(message)

    matched_categories: List[Dict[str, Any]] = []
    budget_chars = _dynamic_menu_budget(user_message, menu_document)
    keyword_map = {
        "dessert": ("dessert", "douceur", "sucre"),
        "entree": ("entree", "entrée", "starter", "apero", "apéritif"),
        "plat": ("plat", "main", "principal"),
        "boisson": ("boisson", "vin", "cocktail", "biere", "bière", "soft", "cafe", "café", "the", "thé"),
        "menu": ("menu", "degustation", "dégustation", "tasting"),
    }

    def _matches_category(name: str) -> bool:
        name_lower = _normalize_text(name)
        if name_lower and name_lower in normalized_message:
            return True
        for _, keywords in keyword_map.items():
            if any(_normalize_text(keyword) in normalized_message and _normalize_text(keyword) in name_lower for keyword in keywords):
                return True
        return False

    def _matches_item(item: Dict[str, Any]) -> bool:
        name = _normalize_text(str(item.get("name") or ""))
        description = _normalize_text(str(item.get("description") or ""))
        if name and name in normalized_message:
            return True
        if not message_tokens:
            return False
        return any(token in name or token in description for token in message_tokens)

    for category in categories:
        category_name = str(category.get("name") or "")
        items = category.get("items") or []
        if not isinstance(items, list):
            continue

        matched_items = []
        if _matches_category(category_name):
            matched_items = items[:MAX_ITEMS_PER_CATEGORY]
        else:
            for item in items:
                if _matches_item(item):
                    matched_items.append(item)
                if len(matched_items) >= MAX_ITEMS_PER_CATEGORY:
                    break

        if matched_items:
            matched_category = dict(category)
            matched_category["items"] = matched_items
            matched_categories.append(matched_category)

    if not matched_categories:
        scored = _score_items(user_message, menu_document)
        if scored:
            budgeted = _apply_menu_budget(menu_document, scored, budget_chars=budget_chars)
            return budgeted
        fallback = []
        for category in categories[:MAX_FALLBACK_CATEGORIES]:
            items = category.get("items") or []
            if not isinstance(items, list):
                continue
            trimmed = dict(category)
            trimmed["items"] = items[:MAX_ITEMS_PER_CATEGORY]
            fallback.append(trimmed)
        filtered = dict(menu_document)
        filtered["categories"] = fallback
        _cache_set(_MENU_FILTER_CACHE, cache_key, filtered)
        return filtered

    filtered = dict(menu_document)
    filtered["categories"] = matched_categories
    scored = _score_items(user_message, filtered)
    result = _apply_menu_budget(filtered, scored, budget_chars=budget_chars)
    _cache_set(_MENU_FILTER_CACHE, cache_key, result)
    return result


async def get_chat_response(
    user_message: str,
    history: Optional[Sequence[ChatMessage]] = None,
    *,
    restaurant_name: str,
    menu_document: Dict[str, Any],
    persisted_constraints: Optional[str] = None,
) -> str:
    """Call OpenAI asynchronously and return the assistant reply."""
    cleaned_history = _prepare_history(history)
    conversation_summary = _summarize_history(cleaned_history)
    recent_history = cleaned_history[-MAX_RECENT_MESSAGES:] if cleaned_history else []
    conversation: List[ChatMessage] = list(recent_history)
    conversation.append({"role": "user", "content": user_message.strip()})
    extracted_constraints = _extract_dietary_constraints(conversation)
    dietary_constraints = _merge_constraints(extracted_constraints, persisted_constraints)
    _, user_language_label = _detect_user_language(user_message)
    filtered_menu = _filter_menu_document(user_message, menu_document)
    system_prompt = _build_system_prompt(
        restaurant_name,
        filtered_menu,
        user_language_label,
        dietary_constraints,
        conversation_summary,
    )
    try:
        return await asyncio.to_thread(_request_completion, conversation, system_prompt)
    except APIError as exc:  # pragma: no cover - depends on network
        logger.error(
            f"Erreur critique OpenAI lors de la génération de réponse : {exc}",
            exc_info=True,
        )
        return DEFAULT_ERROR_MESSAGE
    except Exception as exc:  # pragma: no cover - unexpected
        logger.exception("Erreur inattendue lors de la génération de réponse: %s", exc)
        return DEFAULT_ERROR_MESSAGE
