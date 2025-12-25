"""Menu analytics helpers."""

from __future__ import annotations

from typing import Optional

from app.services import postgrest_client


async def refresh_menu_item_stats(access_token: str, restaurant_id: Optional[str] = None, window_days: int = 30):
    """Recompute aggregated stats for menu items across the specified window."""

    pass


async def get_menu_performance(access_token: str, restaurant_id: Optional[str] = None, window_days: int = 30):
    """Return key performance metrics for a restaurant menu on the given window."""

    pass


async def get_sales_time_series(access_token: str, restaurant_id: Optional[str] = None, window_days: int = 30):
    """Return historical sales data for the restaurant."""

    pass


__all__ = ["refresh_menu_item_stats", "get_menu_performance", "get_sales_time_series"]
