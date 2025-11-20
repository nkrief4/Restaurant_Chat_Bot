"""Shared utilities for talking to Supabase/PostgREST."""

from __future__ import annotations

import logging
from typing import Dict, Optional

from fastapi import HTTPException
from postgrest import APIError as PostgrestAPIError
from postgrest import SyncPostgrestClient

from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)


def extract_bearer_token(header_value: Optional[str]) -> str:
    """Return the Bearer token from an Authorization header."""

    if not header_value:
        raise HTTPException(status_code=401, detail="Authentification requise.")
    parts = header_value.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Jeton Bearer invalide.")
    token = parts[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Jeton Bearer manquant.")
    return token


def create_postgrest_client(
    access_token: str,
    *,
    prefer: Optional[str] = None,
    api_key: Optional[str] = None,
) -> SyncPostgrestClient:
    """Instantiate a PostgREST client authenticated with the provided token."""

    resolved_api_key = api_key or SUPABASE_ANON_KEY
    if not SUPABASE_URL or not resolved_api_key:
        raise HTTPException(status_code=500, detail="Supabase n'est pas configuré.")

    headers: Dict[str, str] = {
        "apikey": resolved_api_key,
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    client = SyncPostgrestClient(f"{SUPABASE_URL.rstrip('/')}/rest/v1", headers=headers)
    client.auth(access_token)
    return client


def raise_postgrest_error(exc: PostgrestAPIError, *, context: str) -> None:
    """Map PostgREST errors to FastAPI HTTP exceptions with logging."""

    status_code = postgrest_status(exc)
    detail = exc.message or "Erreur lors de la communication avec Supabase."
    logger.error("%s failed (%s): %s", context, status_code, detail)
    if status_code == 401:
        raise HTTPException(status_code=401, detail="Authentification Supabase requise.") from exc
    if status_code == 403:
        raise HTTPException(status_code=403, detail="Accès refusé à la ressource demandée.") from exc
    if status_code == 404:
        raise HTTPException(status_code=404, detail="Ressource introuvable.") from exc
    raise HTTPException(status_code=502, detail="Erreur lors de la communication avec Supabase.") from exc


def postgrest_status(exc: PostgrestAPIError) -> int:
    """Best effort extraction of an HTTP status code from the API error."""

    try:
        return int(exc.code) if exc.code else 502
    except (TypeError, ValueError):
        return 502


__all__ = [
    "create_postgrest_client",
    "extract_bearer_token",
    "postgrest_status",
    "raise_postgrest_error",
]
