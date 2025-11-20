"""Business logic for purchase planning independent from the database layer."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SupplierReference(BaseModel):
    """Minimal supplier info attached to recommendations."""

    id: UUID
    name: str


class IngredientRecommendation(BaseModel):
    """Represents the purchasing suggestion for a single ingredient."""

    ingredient_id: UUID
    ingredient_name: str
    unit: str
    current_stock: float
    safety_stock: float
    total_quantity_consumed: float
    avg_daily_consumption: float
    lead_time_days: int
    planning_horizon_days: int
    projected_need: float
    recommended_order_quantity: float
    coverage_days: Optional[float]
    status: str
    default_supplier: Optional[SupplierReference] = None
    last_order_date: Optional[date] = None
    last_order_quantity: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


def compute_purchase_recommendations(
    all_ingredients: List[Dict[str, Any]],
    consumption_data: Dict[Any, float],
    stock_data: Dict[Any, Dict[str, Any]],
    supplier_data: Dict[Any, Dict[str, Any]],
    default_supplier_data: Dict[Any, Dict[str, Any]],
    date_from: date,
    date_to: date,
    reorder_cycle_days: int = 7,
    default_lead_time_days: int = 2,
) -> List[IngredientRecommendation]:
    """Calcule la quantité d'achat recommandée pour chaque ingrédient."""

    if date_to < date_from:
        raise ValueError("date_to must be on or after date_from")

    days_in_range = max((date_to - date_from).days + 1, 1)
    recommendations: List[IngredientRecommendation] = []

    for ingredient in all_ingredients:
        ingredient_id = _coerce_uuid(ingredient.get("id"))
        if ingredient_id is None:
            raise ValueError("Each ingredient must include an 'id'.")

        ingredient_name = str(ingredient.get("name") or "")
        unit = str(ingredient.get("unit") or "")

        stock_entry = _lookup(stock_data, ingredient_id) or {}
        current_stock = _to_float(stock_entry.get("current_stock"), default=0.0)
        safety_stock = _to_float(stock_entry.get("safety_stock"), default=0.0)

        raw_consumption = _lookup(consumption_data, ingredient_id)
        has_consumption_data = raw_consumption is not None
        total_consumed = _to_float(raw_consumption, default=0.0)
        avg_daily_consumption = total_consumed / days_in_range if has_consumption_data else 0.0

        supplier_override = _lookup(supplier_data, ingredient_id) or {}
        lead_time_days, supplier_reference = _resolve_supplier_context(
            ingredient,
            supplier_override,
            default_supplier_data,
            default_lead_time_days,
        )

        planning_horizon_days = lead_time_days + max(reorder_cycle_days, 0)
        projected_need = avg_daily_consumption * planning_horizon_days
        recommended_order_quantity = max(0.0, projected_need + safety_stock - current_stock)
        coverage_days = (
            current_stock / avg_daily_consumption if avg_daily_consumption > 0 else None
        )
        status = _determine_status(
            has_consumption_data,
            coverage_days,
            recommended_order_quantity,
            lead_time_days,
            planning_horizon_days,
        )

        recommendation = IngredientRecommendation(
            ingredient_id=ingredient_id,
            ingredient_name=ingredient_name,
            unit=unit,
            current_stock=current_stock,
            safety_stock=safety_stock,
            total_quantity_consumed=total_consumed,
            avg_daily_consumption=avg_daily_consumption,
            lead_time_days=lead_time_days,
            planning_horizon_days=planning_horizon_days,
            projected_need=projected_need,
            recommended_order_quantity=recommended_order_quantity,
            coverage_days=coverage_days,
            status=status,
            default_supplier=supplier_reference,
            last_order_date=_parse_date(ingredient.get("last_order_date")),
            last_order_quantity=_to_float(ingredient.get("last_order_quantity"), default=None),
        )
        recommendations.append(recommendation)

    return recommendations


def _resolve_supplier_context(
    ingredient: Dict[str, Any],
    supplier_override: Dict[str, Any],
    default_supplier_data: Dict[Any, Dict[str, Any]],
    default_lead_time_days: int,
) -> tuple[int, Optional[SupplierReference]]:
    default_supplier_id = _coerce_uuid(ingredient.get("default_supplier_id"))
    override_supplier_id = _coerce_uuid(supplier_override.get("supplier_id"))
    supplier_id = override_supplier_id or default_supplier_id

    lead_time = supplier_override.get("lead_time_days")
    supplier_record = _lookup(default_supplier_data, supplier_id) if supplier_id else None

    if lead_time is None and supplier_record is not None:
        lead_time = supplier_record.get("default_lead_time_days")

    lead_time_days = int(lead_time) if lead_time is not None else int(default_lead_time_days)

    supplier_name = supplier_override.get("supplier_name")
    if not supplier_name and supplier_record is not None:
        supplier_name = supplier_record.get("name")

    supplier_reference = None
    if supplier_id is not None and supplier_name:
        supplier_reference = SupplierReference(id=supplier_id, name=str(supplier_name))

    return lead_time_days, supplier_reference


def _lookup(mapping: Dict[Any, Any], key: Optional[UUID]) -> Any:
    if mapping is None or key is None:
        return None
    if key in mapping:
        return mapping[key]
    key_str = str(key)
    if key_str in mapping:
        return mapping[key_str]
    return None


def _coerce_uuid(value: Any) -> Optional[UUID]:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _to_float(value: Any, *, default: Optional[float]) -> Optional[float]:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _determine_status(
    has_consumption_data: bool,
    coverage_days: Optional[float],
    recommended_order_quantity: float,
    lead_time_days: int,
    planning_horizon_days: int,
) -> str:
    if not has_consumption_data:
        return "NO_DATA"

    if recommended_order_quantity <= 0:
        return "OK"

    if coverage_days is None:
        return "LOW"

    if coverage_days <= lead_time_days:
        return "CRITICAL"

    if coverage_days <= planning_horizon_days:
        return "LOW"

    return "OK"
