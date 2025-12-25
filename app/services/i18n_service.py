"""Internationalization helpers."""

from __future__ import annotations

from app.services import postgrest_client


def get_user_language(user_id):
    """Return the preferred language for the specified user."""

    pass


def translate_menu_items(restaurant_id, language_code):
    """Translate all menu items for a restaurant into the given language."""

    pass


def translate_menu_categories(restaurant_id, language_code):
    """Translate menu category names for the provided language."""

    pass


__all__ = ["get_user_language", "translate_menu_items", "translate_menu_categories"]
