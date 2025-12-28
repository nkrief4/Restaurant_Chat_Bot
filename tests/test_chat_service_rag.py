import json

from app.services.chat_service import _build_system_prompt, _filter_menu_document


def _sample_menu():
    return {
        "categories": [
            {
                "name": "Entrées",
                "items": [
                    {"name": "Burrata", "description": "Tomates anciennes, basilic"},
                    {"name": "Carpaccio", "description": "Boeuf, parmesan"},
                ],
            },
            {
                "name": "Plats",
                "items": [
                    {"name": "Risotto", "description": "Champignons, parmesan"},
                    {"name": "Poulet rôti", "description": "Pommes de terre"},
                ],
            },
            {
                "name": "Desserts",
                "items": [
                    {"name": "Tiramisu", "description": "Café, mascarpone"},
                    {"name": "Sorbet citron", "description": "Basilic"},
                ],
            },
            {
                "name": "Boissons",
                "items": [
                    {"name": "Espresso", "description": "Café"},
                    {"name": "Verre de vin", "description": "Rouge"},
                ],
            },
        ]
    }


def test_prompt_is_smaller_with_filtered_menu():
    menu = _sample_menu()
    user_message = "Quels desserts proposez-vous ?"

    filtered = _filter_menu_document(user_message, menu)

    constraints = "- Aucune contrainte explicite."
    full_prompt = _build_system_prompt("Test", menu, "français", constraints)
    filtered_prompt = _build_system_prompt("Test", filtered, "français", constraints)

    # Sanity: filtered menu keeps only relevant categories.
    filtered_names = [cat.get("name") for cat in filtered.get("categories", [])]
    assert "Desserts" in filtered_names
    assert len(filtered_names) < len(menu["categories"])

    # Ensure prompt size is reduced.
    assert len(filtered_prompt) < len(full_prompt)

    # Optional clarity if you print locally: shows the approximate token ratio.
    full_chars = len(json.dumps(menu, ensure_ascii=False))
    filtered_chars = len(json.dumps(filtered, ensure_ascii=False))
    assert filtered_chars < full_chars
