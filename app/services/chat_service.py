"""Chat service responsible for calling OpenAI with menu context."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import APIError

from app.config.openai_client import client
from app.config.supabase_client import DEFAULT_RESTAURANT_SLUG, get_supabase_client


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


def _load_menu_from_supabase() -> Optional[Dict[str, Any]]:
    client_instance = get_supabase_client()
    if client_instance is None:
        return None

    try:
        response = (
            client_instance.table("restaurants")
            .select("menu_document")
            .eq("slug", DEFAULT_RESTAURANT_SLUG)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - depends on network
        print(f"Erreur Supabase: {exc}")
        return None

    rows = getattr(response, "data", None) or []
    if not rows:
        return None

    document = rows[0].get("menu_document")
    if isinstance(document, dict):
        return document

    try:
        return json.loads(document)
    except Exception:
        return None


MENU_DATA: Dict[str, Any] = _load_menu_from_supabase()
if MENU_DATA is None:
    raise RuntimeError("Failed to load menu from Supabase. Database access error or menu not found.")

MENU_CONTEXT = json.dumps(MENU_DATA, ensure_ascii=False)
DIETARY_INDEX = _build_dietary_index(MENU_DATA)
DIETARY_CONTEXT = json.dumps(DIETARY_INDEX, ensure_ascii=False, indent=2)

SYSTEM_PROMPT = (
    "Tu es l'assistant virtuel du restaurant La Trattoria di Nathan. "
    "Tu ne gères que les questions liées à ce restaurant (menu, régimes, horaires, coordonnées). "
    "Tu ne prends pas de réservations ni de commandes et tu n'inventes aucune information. "
    "Utilise strictement les champs fournis dans le menu, notamment 'tags', 'contains' et 'dietaryGuide'. "
    "Si la personne parle de régime casher/kasher/kosher, halal, végétarien, végétalien, sans porc, sans crustacés, ou d'allergènes, "
    "fais des listes complètes des plats compatibles en t'appuyant sur ces tags et précise la catégorie du plat. "
    "Si le régime alimentaire de la personne ne convient pas à certains plats, ne propose pas ces plats. "
    "FORMAT : ne commence pas par une phrase courte de synthèse, mais crée des sections explicites avec le préfixe 'Section :' "
    "(ex. 'Section : Plats casher disponibles') et sous chaque section affiche des listes à puces avec le symbole '•'. "
    "Chaque plat doit être formaté comme suit : \"• Nom (Catégorie) – Prix € – ce que contient le plat\"."
    "A la fin de la réponse, ne propose pas autres choses, simplement réponds à la question de la personne qui te pose la question."
    "Lorsque tu evoques un plat, donne la description du plat, le prix et le contenu du plat."
    "Réponds en français ou en anglais ou en espagnol (cela dépend de la langue de la personne qui te pose la question), avec un ton poli, des phrases courtes et des suggestions basées uniquement sur les données ci-dessous.\n\n"
    f"Données complètes du menu (issues de la base de données, JSON):\n{MENU_CONTEXT}\n\n"
    f"Index des régimes (tag -> plats):\n{DIETARY_CONTEXT}"
)


def _request_completion(message: str) -> str:
    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
    )
    if completion.choices:
        reply = completion.choices[0].message.content
        return reply or "Désolé, je n'ai pas pu générer de réponse."
    return "Désolé, je n'ai pas pu générer de réponse."


async def get_chat_response(user_message: str) -> str:
    """Call OpenAI asynchronously and return the assistant reply."""
    try:
        return await asyncio.to_thread(_request_completion, user_message)
    except APIError as exc:  # pragma: no cover - depends on network
        print(f"Erreur OpenAI: {exc}")
        return "Désolé, une erreur est survenue avec le service d'IA."
    except Exception as exc:  # pragma: no cover - unexpected
        print(f"Erreur inattendue: {exc}")
        return "Désolé, je rencontre un problème technique pour le moment."
