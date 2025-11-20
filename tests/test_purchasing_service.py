from datetime import date
from pathlib import Path
from uuid import uuid4
import sys

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.purchasing import compute_purchase_recommendations


def test_compute_recommendations_handles_stock_levels() -> None:
    low_ing_id = uuid4()
    high_ing_id = uuid4()
    supplier_low_id = uuid4()
    supplier_high_id = uuid4()

    ingredients = [
        {
            "id": low_ing_id,
            "name": "Tomates",
            "unit": "kg",
            "default_supplier_id": supplier_low_id,
            "last_order_date": date(2024, 5, 1),
            "last_order_quantity": 12,
        },
        {
            "id": high_ing_id,
            "name": "Mozzarella",
            "unit": "kg",
            "default_supplier_id": supplier_high_id,
        },
    ]
    consumption_data = {
        low_ing_id: 14.0,
        str(high_ing_id): 7.0,
    }
    stock_data = {
        low_ing_id: {"current_stock": 2, "safety_stock": 1},
        str(high_ing_id): {"current_stock": 120, "safety_stock": 5},
    }
    supplier_data = {
        low_ing_id: {"lead_time_days": 5},
    }
    default_supplier_data = {
        supplier_low_id: {"name": "Fresh Farms", "default_lead_time_days": 3},
        str(supplier_high_id): {"name": "Fine Cheese Co", "default_lead_time_days": 4},
    }

    recommendations = compute_purchase_recommendations(
        ingredients,
        consumption_data,
        stock_data,
        supplier_data,
        default_supplier_data,
        date_from=date(2024, 5, 1),
        date_to=date(2024, 5, 7),
    )

    assert len(recommendations) == 2
    low_rec, high_rec = recommendations

    assert low_rec.status == "CRITICAL"
    assert low_rec.default_supplier is not None
    assert low_rec.default_supplier.name == "Fresh Farms"
    assert low_rec.recommended_order_quantity == pytest.approx(23.0)
    assert low_rec.coverage_days == pytest.approx(1.0)

    assert high_rec.status == "OK"
    assert high_rec.recommended_order_quantity == 0
    assert high_rec.coverage_days == pytest.approx(120.0)


def test_compute_recommendations_marks_no_data_when_missing_consumption() -> None:
    ing_id = uuid4()
    supplier_id = uuid4()
    ingredients = [
        {
            "id": ing_id,
            "name": "Basilic",
            "unit": "bunch",
            "default_supplier_id": supplier_id,
        }
    ]

    recommendations = compute_purchase_recommendations(
        ingredients,
        consumption_data={},
        stock_data={ing_id: {"current_stock": 5, "safety_stock": 1}},
        supplier_data={},
        default_supplier_data={supplier_id: {"name": "Herb Source", "default_lead_time_days": 3}},
        date_from=date(2024, 5, 1),
        date_to=date(2024, 5, 7),
    )

    assert recommendations[0].status == "NO_DATA"
    assert recommendations[0].recommended_order_quantity == 0
    assert recommendations[0].coverage_days is None
    assert recommendations[0].total_quantity_consumed == 0


def test_recommended_quantity_is_never_negative() -> None:
    ing_id = uuid4()
    ingredients = [
        {"id": ing_id, "name": "Olive Oil", "unit": "L"},
    ]

    recommendations = compute_purchase_recommendations(
        ingredients,
        consumption_data={ing_id: 10.0},
        stock_data={ing_id: {"current_stock": 200, "safety_stock": 0}},
        supplier_data={},
        default_supplier_data={},
        date_from=date(2024, 5, 1),
        date_to=date(2024, 5, 10),
    )

    assert recommendations[0].recommended_order_quantity == 0
    assert recommendations[0].status == "OK"


def test_lead_time_priority_ordering() -> None:
    supplier_id = uuid4()
    ingredient_with_override = uuid4()
    ingredient_with_default = uuid4()
    ingredient_with_fallback = uuid4()

    ingredients = [
        {"id": ingredient_with_override, "name": "Pasta", "unit": "kg", "default_supplier_id": supplier_id},
        {"id": ingredient_with_default, "name": "Cheese", "unit": "kg", "default_supplier_id": supplier_id},
        {"id": ingredient_with_fallback, "name": "Pepper", "unit": "g"},
    ]

    recommendations = compute_purchase_recommendations(
        ingredients,
        consumption_data={
            ingredient_with_override: 14.0,
            ingredient_with_default: 14.0,
            ingredient_with_fallback: 14.0,
        },
        stock_data={
            ingredient_with_override: {"current_stock": 5, "safety_stock": 1},
            ingredient_with_default: {"current_stock": 5, "safety_stock": 1},
            ingredient_with_fallback: {"current_stock": 5, "safety_stock": 1},
        },
        supplier_data={ingredient_with_override: {"lead_time_days": 9}},
        default_supplier_data={supplier_id: {"name": "Main Supplier", "default_lead_time_days": 6}},
        date_from=date(2024, 5, 1),
        date_to=date(2024, 5, 7),
        default_lead_time_days=2,
    )

    assert recommendations[0].lead_time_days == 9  # override from ingredient_suppliers
    assert recommendations[1].lead_time_days == 6  # from default supplier
    assert recommendations[2].lead_time_days == 2  # fallback parameter
