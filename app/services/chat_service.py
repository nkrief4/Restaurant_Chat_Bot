"""Chat service responsible for calling OpenAI with menu context."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypedDict

from openai import APIError
from langdetect import DetectorFactory, LangDetectException, detect

from app.config.openai_client import client
from app.config.supabase_client import get_supabase_client


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
    "Tu es l'assistant virtuel du restaurant {restaurant_name}. "
    "Tu ne gères que les questions liées à ce restaurant (menu, régimes, horaires, coordonnées). "
    "Tu ne prends pas de réservations ni de commandes et tu n'inventes aucune information. "
    "Utilise strictement les champs fournis dans le menu, notamment 'tags', 'contains' et 'dietaryGuide'. "
    "Si la personne parle de régime casher/kasher/kosher, halal, végétarien, végétalien, sans porc, sans crustacés, ou d'allergènes, "
    "fais des listes complètes des plats compatibles en t'appuyant sur ces tags et précise la catégorie du plat. "
    "Ne cite jamais un plat non compatible avec les contraintes explicites de l'utilisateur et explique que rien n'est disponible si nécessaire. "
    "FORMAT : ne commence pas par une phrase courte de synthèse, mais crée des sections explicites avec le préfixe 'Section :' "
    "(ex. 'Section : Plats casher disponibles') et sous chaque section affiche des listes à puces avec le symbole '•'. "
    "Chaque plat doit être formaté comme suit : \"• Nom (Catégorie) – Prix € – ce que contient le plat\"."
    "A la fin de la réponse, ne propose pas autres choses, simplement réponds à la question de la personne qui te pose la question."
    "Lorsque tu évoques un plat, donne la description du plat, le prix et le contenu du plat."
    "Si on te demande des précisions sur un poisson ou un ingrédient au nom peu courant, fournis une courte description culinaire et précise si le menu contient des plats correspondants."
    "La personne s'exprime en {user_language_label}. Réponds strictement dans cette langue avec un ton poli, des phrases courtes et des suggestions basées uniquement sur les données ci-dessous.\n\n"
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
        return reply or "Désolé, je n'ai pas pu générer de réponse."
    return "Désolé, je n'ai pas pu générer de réponse."


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
        print(f"Erreur OpenAI: {exc}")
        return "Désolé, une erreur est survenue avec le service d'IA."
    except Exception as exc:  # pragma: no cover - unexpected
        print(f"Erreur inattendue: {exc}")
        return "Désolé, je rencontre un problème technique pour le moment."

async def sign_up(email, password):
    supabase = get_supabase_client()
    if not supabase:
        raise ValueError("Supabase client not initialized.")
    try:
        response = await asyncio.to_thread(supabase.auth.sign_up, {"email": email, "password": password})
        return response
    except Exception as e:
        print(f"Error during sign-up: {e}")
        return None


async def sign_in(email, password):
    supabase = get_supabase_client()
    if not supabase:
        raise ValueError("Supabase client not initialized.")
    try:
        response = await asyncio.to_thread(supabase.auth.sign_in_with_password, {"email": email, "password": password})
        return response
    except Exception as e:
        print(f"Error during sign-in: {e}")
        return None
