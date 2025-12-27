"""Helpers to retrieve restaurant records accessible to a user."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, TypeVar, Callable

import logging
import time

from httpx import HTTPError as HttpxError

from app.config.supabase_client import SUPABASE_URL, get_supabase_client

logger = logging.getLogger(__name__)
T = TypeVar("T")


def _retry_supabase_call(
    operation: Callable[[], T],
    *,
    retries: int = 2,
    backoff_seconds: Sequence[float] = (0.2, 0.5, 1.0),
    label: str,
) -> T:
    """Run a Supabase call with a short retry/backoff strategy."""

    attempts = retries + 1
    for attempt in range(1, attempts + 1):
        start = time.monotonic()
        try:
            result = operation()
            duration_ms = (time.monotonic() - start) * 1000
            logger.debug(
                "Supabase call succeeded",
                extra={
                    "label": label,
                    "duration_ms": round(duration_ms, 2),
                    "supabase_url": SUPABASE_URL,
                },
            )
            return result
        except HttpxError as exc:
            duration_ms = (time.monotonic() - start) * 1000
            logger.warning(
                "Supabase call failed",
                extra={
                    "label": label,
                    "attempt": attempt,
                    "duration_ms": round(duration_ms, 2),
                    "supabase_url": SUPABASE_URL,
                    "error": str(exc),
                },
            )
            if attempt >= attempts:
                raise RuntimeError("Supabase unreachable.") from exc
            delay = backoff_seconds[min(attempt - 1, len(backoff_seconds) - 1)]
            time.sleep(delay)
    raise RuntimeError("Supabase unreachable.")


def get_restaurants_for_user(user_id: str) -> List[Dict[str, Any]]:
    """Return all restaurants accessible to the provided user."""

    client = get_supabase_client()
    if client is None:
        raise RuntimeError("Supabase client is not configured.")

    def _fetch_tenants() -> Any:
        return (
            client.table("user_tenants")
            .select("tenant_id")
            .eq("user_id", user_id)
            .execute()
        )

    tenant_response = _retry_supabase_call(
        _fetch_tenants,
        label="get_restaurants_for_user:tenants",
    )
    tenant_ids = {row["tenant_id"] for row in tenant_response.data or [] if row.get("tenant_id")}
    if not tenant_ids:
        return []

    def _fetch_restaurants() -> Any:
        return (
            client.table("restaurants")
            .select("*")
            .in_("tenant_id", list(tenant_ids))
            .order("created_at", desc=False)
            .execute()
        )

    restaurants_response = _retry_supabase_call(
        _fetch_restaurants,
        label="get_restaurants_for_user:restaurants",
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

    def _fetch_tenants() -> Any:
        return (
            client.table("user_tenants")
            .select("tenant_id")
            .eq("user_id", user_id)
            .execute()
        )

    tenant_response = _retry_supabase_call(
        _fetch_tenants,
        label="user_can_access_restaurant:tenants",
    )
    tenant_ids = {row["tenant_id"] for row in tenant_response.data or [] if row.get("tenant_id")}
    if not tenant_ids:
        return False

    def _fetch_restaurant() -> Any:
        return (
            client.table("restaurants")
            .select("id")
            .eq("id", restaurant_id)
            .in_("tenant_id", list(tenant_ids))
            .limit(1)
            .execute()
        )

    restaurant_response = _retry_supabase_call(
        _fetch_restaurant,
        label="user_can_access_restaurant:restaurant",
    )
    has_access = bool(restaurant_response.data)
    return has_access


__all__ = ["get_restaurants_for_user", "get_default_restaurant_for_user", "user_can_access_restaurant"]
