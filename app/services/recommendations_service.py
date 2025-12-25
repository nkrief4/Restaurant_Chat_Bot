"""High-level business recommendations."""

from __future__ import annotations

from typing import Optional

from app.config import openai_client
from app.services import menu_stats_service, stock_service


async def generate_raw_business_insights(access_token: str, restaurant_id: Optional[str] = None):
    """Prepare insight snippets by combining menu stats, stock, and AI summarization."""

    pass


async def generate_business_report(access_token: str, restaurant_id: Optional[str] = None):
    """Produce a structured business report for the restaurant."""

    pass


__all__ = ["generate_raw_business_insights", "generate_business_report"]
