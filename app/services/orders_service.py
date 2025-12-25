"""Order coordination service."""

from __future__ import annotations

import base64
import json
from typing import Any, Dict, Optional

from fastapi import HTTPException
from postgrest import APIError as PostgrestAPIError

from app.services import (
    menu_stats_service,
    postgrest_client,
    restaurant_service,
    stock_service,
)


def record_order(user: Any, payload) -> Dict[str, Any]:
    """Persist an incoming order, update stock, and refresh menu statistics."""

    access_token = _extract_access_token(user)
    if not access_token:
        raise HTTPException(status_code=401, detail="Utilisateur non authentifié.")

    user_id = _extract_user_id(user, access_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Utilisateur Supabase invalide.")

    restaurant_id = getattr(payload, "restaurant_id", None)
    if not restaurant_id:
        default_restaurant = restaurant_service.get_default_restaurant_for_user(user_id)
        if not default_restaurant:
            raise HTTPException(status_code=400, detail="Aucun restaurant associé à cet utilisateur.")
        restaurant_id = default_restaurant.get("id")

    if not restaurant_id:
        raise HTTPException(status_code=400, detail="Restaurant invalide.")

    if not restaurant_service.user_can_access_restaurant(user_id, str(restaurant_id)):
        raise HTTPException(status_code=403, detail="Accès interdit à ce restaurant.")

    order_payload = {
        "restaurant_id": str(restaurant_id),
        "menu_item_id": str(getattr(payload, "menu_item_id")),
        "quantity": int(getattr(payload, "quantity", 1) or 1),
        "source": getattr(payload, "source", None) or "manual",
    }

    try:
        record = _insert_order(access_token, order_payload)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        postgrest_client.raise_postgrest_error(exc, context="order creation")

    stock_service.update_stock_from_order(str(restaurant_id), str(getattr(payload, "menu_item_id")), getattr(payload, "quantity", 1))
    menu_stats_service.refresh_menu_item_stats(str(restaurant_id))

    order_id = record.get("id")
    recorded_restaurant_id = record.get("restaurant_id")
    recorded_menu_item_id = record.get("menu_item_id")
    return {
        "id": str(order_id) if order_id is not None else None,
        "restaurant_id": str(recorded_restaurant_id) if recorded_restaurant_id is not None else None,
        "menu_item_id": str(recorded_menu_item_id) if recorded_menu_item_id is not None else None,
        "quantity": record.get("quantity"),
        "source": record.get("source"),
        "ordered_at": record.get("ordered_at"),
    }


def _insert_order(access_token: str, body: Dict[str, Any]) -> Dict[str, Any]:
    with postgrest_client.create_postgrest_client(access_token, prefer="return=representation") as client:
        response = client.table("orders").insert(body).execute()
        if not response.data:
            raise HTTPException(status_code=502, detail="Création de commande impossible.")
        return response.data[0]


def _extract_access_token(user: Any) -> Optional[str]:
    if isinstance(user, str):
        return user
    if isinstance(user, dict):
        token = user.get("access_token") or user.get("token")
        if token:
            return str(token)
    return getattr(user, "access_token", None) or getattr(user, "token", None)


def _extract_user_id(user: Any, access_token: Optional[str]) -> Optional[str]:
    if isinstance(user, dict):
        for key in ("sub", "id", "user_id"):
            value = user.get(key)
            if value:
                return str(value)
    candidate = getattr(user, "id", None) or getattr(user, "user_id", None) or getattr(user, "sub", None)
    if candidate:
        return str(candidate)
    if not access_token:
        return None
    try:
        payload_segment = access_token.split(".")[1]
        padding = "=" * (-len(payload_segment) % 4)
        decoded = base64.urlsafe_b64decode((payload_segment + padding).encode("ascii"))
        claims = json.loads(decoded.decode("utf-8"))
        sub = claims.get("sub")
        return str(sub) if sub else None
    except Exception:
        return None


__all__ = ["record_order"]
