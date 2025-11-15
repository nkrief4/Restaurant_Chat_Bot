"""Supabase client configuration and helpers."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv

try:
    from supabase import Client, create_client
except ImportError:  # pragma: no cover - optional dependency during tooling
    Client = None  # type: ignore
    create_client = None  # type: ignore

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
DEFAULT_RESTAURANT_SLUG = os.getenv("RESTAURANT_SLUG", "la-trattoria-di-nathan")


@lru_cache(maxsize=1)
def get_supabase_client() -> Optional["Client"]:
    """Instantiate the Supabase client if credentials are configured."""
    api_key = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
    if not SUPABASE_URL or not api_key or create_client is None:
        return None
    return create_client(SUPABASE_URL, api_key)


__all__ = [
    "get_supabase_client",
    "DEFAULT_RESTAURANT_SLUG",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
]
