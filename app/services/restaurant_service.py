"""Helpers to retrieve restaurant records accessible to a user."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.config.supabase_client import get_supabase_client


def get_restaurants_for_user(user_id: str) -> List[Dict[str, Any]]:
    """Return all restaurants accessible to the provided user."""

    client = get_supabase_client()
    if client is None:
        raise RuntimeError("Supabase client is not configured.")

    tenant_response = (
        client.table("user_tenants")
        .select("tenant_id")
        .eq("user_id", user_id)
        .execute()
    )
    tenant_ids = {row["tenant_id"] for row in tenant_response.data or [] if row.get("tenant_id")}
    if not tenant_ids:
        return []

    restaurants_response = (
        client.table("restaurants")
        .select("*")
        .in_("tenant_id", list(tenant_ids))
        .order("created_at", desc=False)
        .execute()
    )
    return restaurants_response.data or []


def get_default_restaurant_for_user(user_id: str) -> Optional[Dict[str, Any]]:
    """Return the first restaurant accessible to the user (if any)."""

    restaurants = get_restaurants_for_user(user_id)
    if not restaurants:
        return None
    return restaurants[0]


def user_can_access_restaurant(user_id: str, restaurant_id: str) -> bool:
    """Return True if the restaurant belongs to one of the user's tenants."""

    client = get_supabase_client()
    if client is None:
        raise RuntimeError("Supabase client is not configured.")

    tenant_response = (
        client.table("user_tenants")
        .select("tenant_id")
        .eq("user_id", user_id)
        .execute()
    )
    tenant_ids = {row["tenant_id"] for row in tenant_response.data or [] if row.get("tenant_id")}
    if not tenant_ids:
        return False

    restaurant_response = (
        client.table("restaurants")
        .select("id")
        .eq("id", restaurant_id)
        .in_("tenant_id", list(tenant_ids))
        .limit(1)
        .execute()
    )
    return bool(restaurant_response.data)


__all__ = ["get_restaurants_for_user", "get_default_restaurant_for_user", "user_can_access_restaurant"]
