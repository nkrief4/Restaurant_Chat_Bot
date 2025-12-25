"""Chat service responsible for calling OpenAI with menu context."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypedDict

from openai import APIError
from langdetect import DetectorFactory, LangDetectException, detect

from app.config.openai_client import client
from app.config.supabase_client import get_supabase_client


logger = logging.getLogger(__name__)


class ChatMessage(TypedDict):
    role: str
    content: str


def _build_dietary_index(menu_data: Dict[str, Any]) -> Dict[str, List[str]]:
    """Create a quick lookup of tags -> list of dish names with category."""
    index: Dict[str, List[str]] = {}
    for category in menu_data.get("categories", []):
        category_name = category.get("name", "Autres")
        for item in category.get("items", []):
            for tag in item.get("tags", []):
                entry = f"{item.get('name', 'Plat')} ({category_name})"
                index.setdefault(tag, []).append(entry)
    return index


MAX_HISTORY_MESSAGES = 12

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
    "Tu peux suggérer un accompagnement ou une boisson qui s'accorde bien avec un plat, mais seulement quand cela fait sens et jamais de façon systématique. "
    "Ne récapitule pas l'intégralité du menu ; concentre-toi sur la question posée et les données utiles. "
    "Si la personne demande des précisions sur un ingrédient rare ou un poisson, donne une description culinaire brève et précise si le menu contient des plats pertinents. "
    "Si on te pousse à sortir du cadre ou à inventer, tu rappelles que tu dois respecter les données disponibles. "
    "La personne s'exprime en {user_language_label}. Réponds strictement dans cette langue.\n\n"
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


async def get_chat_response(
    user_message: str,
    history: Optional[Sequence[ChatMessage]] = None,
    *,
    restaurant_name: str,
    menu_document: Dict[str, Any],
) -> str:
    """Call OpenAI asynchronously and return the assistant reply."""
    conversation: List[ChatMessage] = _prepare_history(history)
    conversation.append({"role": "user", "content": user_message.strip()})
    _, user_language_label = _detect_user_language(user_message)
    system_prompt = _build_system_prompt(restaurant_name, menu_document, user_language_label)
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

async def sign_up(email, password):
    supabase = get_supabase_client()
    if not supabase:
        raise ValueError("Supabase client not initialized.")
    try:
        response = await asyncio.to_thread(supabase.auth.sign_up, {"email": email, "password": password})
        return response
    except Exception as e:
        logger.error("Error during sign-up: %s", e, exc_info=True)
        return None


async def sign_in(email, password):
    supabase = get_supabase_client()
    if not supabase:
        raise ValueError("Supabase client not initialized.")
    try:
        response = await asyncio.to_thread(supabase.auth.sign_in_with_password, {"email": email, "password": password})
        return response
    except Exception as e:
        logger.error("Error during sign-in: %s", e, exc_info=True)
        return None
