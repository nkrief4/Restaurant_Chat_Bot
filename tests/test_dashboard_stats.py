from app.services.dashboard_service import _summarize_questions, _diet_breakdown


def test_summarize_questions_normalizes_accents():
    chat_rows = [
        {"user_prompt": "Réservation pour ce soir"},
        {"user_prompt": "reservation demain"},
        {"user_prompt": "Quels sont vos horaires ?"},
        {"user_prompt": "Merci"},
    ]

    summary = _summarize_questions(chat_rows)
    summary_map = {entry["label"]: entry["count"] for entry in summary}

    assert summary_map.get("Réservations") == 2
    assert summary_map.get("Horaires") == 1
    assert summary_map.get("Autres") == 1


def test_diet_breakdown_handles_tags_and_dietary_guide():
    restaurants = [
        {
            "menu_document": {
                "categories": [
                    {
                        "name": "Plats",
                        "items": [
                            {"name": "Salade", "tags": ["Vegan", {"label": "Sans gluten"}]},
                            {"name": "Soupe", "tags": [{"label": "vegan"}]},
                        ],
                    }
                ],
                "dietaryGuide": [
                    {"label": "Halal", "items": ["Poulet", "Agneau"]},
                ],
            }
        }
    ]

    breakdown = _diet_breakdown(restaurants)
    breakdown_map = {entry["label"]: entry["count"] for entry in breakdown}

    assert breakdown_map.get("Vegan") == 2
    assert breakdown_map.get("Sans Gluten") == 1
    assert breakdown_map.get("Halal") == 2
