"""Stock management helpers."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from fastapi import HTTPException
from postgrest import APIError as PostgrestAPIError

from app.config.supabase_client import SUPABASE_SERVICE_ROLE_KEY
from app.services import postgrest_client


def update_stock_from_order(restaurant_id, menu_item_id, quantity):
    """Decrease stock for a given menu item after an order is recorded."""

    recipe_lines = _fetch_recipe_lines(restaurant_id, menu_item_id)
    if not recipe_lines:
        return

    consumed: Dict[str, float] = {}
    for line in recipe_lines:
        ingredient_id = line.get("ingredient_id")
        per_unit = float(line.get("quantity_per_unit") or 0)
        if not ingredient_id or per_unit <= 0:
            continue
        consumed[ingredient_id] = consumed.get(ingredient_id, 0.0) + per_unit * max(float(quantity or 0), 0.0)

    if not consumed:
        return

    stock_rows = _fetch_ingredient_stock(restaurant_id, consumed.keys())
    if not stock_rows:
        return

    token = _require_service_token()

    try:
        with postgrest_client.create_postgrest_client(token, api_key=token) as client:
            for ingredient_id, total_consumed in consumed.items():
                stock_entry = stock_rows.get(ingredient_id)
                if not stock_entry:
                    continue
                current_value = float(stock_entry.get("current_stock") or 0)
                new_value = max(current_value - total_consumed, 0.0)
                client.table("ingredient_stock").update({"current_stock": new_value}).eq(
                    "restaurant_id", str(restaurant_id)
                ).eq("ingredient_id", ingredient_id).execute()
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        postgrest_client.raise_postgrest_error(exc, context="update ingredient stock from order")


def get_stock_overview(restaurant_id):
    """Return the latest stock levels for all tracked items in a restaurant."""

    token = _require_service_token()

    try:
        with postgrest_client.create_postgrest_client(token, api_key=token) as client:
            stock_response = (
                client.table("ingredient_stock")
                .select("*")
                .eq("restaurant_id", str(restaurant_id))
                .execute()
            )
            ingredient_response = (
                client.table("ingredients")
                .select("id,name")
                .eq("restaurant_id", str(restaurant_id))
                .execute()
            )
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        postgrest_client.raise_postgrest_error(exc, context="fetch stock overview")

    stock_rows = stock_response.data or []
    ingredient_rows = ingredient_response.data or []
    ingredient_map = {row.get("id"): row for row in ingredient_rows if row.get("id")}

    items: List[Dict[str, Any]] = []
    for stock_row in stock_rows:
        ingredient_id = stock_row.get("ingredient_id")
        ingredient_row = ingredient_map.get(ingredient_id, {})
        items.append(build_stock_status_row(ingredient_row, stock_row))

    return {"items": items}


def build_stock_status_row(
    ingredient_row: Dict[str, Any],
    stock_row: Dict[str, Any],
    category_row: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Return a normalized stock status entry for UI consumption."""

    ingredient_id = ingredient_row.get("id")
    ingredient_name = ingredient_row.get("name")
    current_stock = _to_float(stock_row.get("current_stock"), default=0.0)
    safety_stock = _to_float(stock_row.get("safety_stock"), default=0.0)

    if safety_stock > 0:
        critical_threshold = safety_stock * 0.2
        if current_stock <= critical_threshold:
            status = "critical"
        elif current_stock <= safety_stock:
            status = "low"
        else:
            status = "ok"
    else:
        status = "critical" if current_stock <= 0 else "ok"

    entry: Dict[str, Any] = {
        "ingredient_id": str(ingredient_id) if ingredient_id is not None else None,
        "ingredient_name": ingredient_name,
        "current_stock": current_stock,
        "safety_stock": safety_stock,
        "status": status,
    }
    if category_row:
        entry["category_id"] = category_row.get("id")
        entry["category_name"] = category_row.get("name")
    return entry


def _fetch_recipe_lines(restaurant_id, menu_item_id) -> List[Dict[str, Any]]:
    """Return all recipe rows for the menu item within the restaurant."""

    token = _require_service_token()

    try:
        with postgrest_client.create_postgrest_client(token, api_key=token) as client:
            response = (
                client.table("recipes")
                .select("ingredient_id,quantity_per_unit")
                .eq("restaurant_id", str(restaurant_id))
                .eq("menu_item_id", str(menu_item_id))
                .execute()
            )
            return response.data or []
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        postgrest_client.raise_postgrest_error(exc, context="fetch recipe lines")


def _fetch_ingredient_stock(restaurant_id, ingredient_ids: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
    """Return ingredient stock rows indexed by ingredient_id."""

    ids = [str(identifier) for identifier in ingredient_ids if identifier]
    if not ids:
        return {}

    token = _require_service_token()

    try:
        with postgrest_client.create_postgrest_client(token, api_key=token) as client:
            response = (
                client.table("ingredient_stock")
                .select("*")
                .eq("restaurant_id", str(restaurant_id))
                .in_("ingredient_id", ids)
                .execute()
            )
            rows = response.data or []
            return {row.get("ingredient_id"): row for row in rows if row.get("ingredient_id")}
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        postgrest_client.raise_postgrest_error(exc, context="fetch ingredient stock")


def _require_service_token() -> str:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service credentials are missing.")
    return SUPABASE_SERVICE_ROLE_KEY


def _to_float(value: Any, *, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


__all__ = ["update_stock_from_order", "get_stock_overview"]
