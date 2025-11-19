"""Secure interactions with Supabase authentication."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)


class AuthenticationError(RuntimeError):
    """Base error raised when the auth flow cannot be completed."""


class InvalidCredentials(AuthenticationError):
    """Raised when Supabase explicitly rejects the credentials."""


@dataclass(frozen=True)
class AuthSession:
    """Subset of the session information needed by the frontend."""

    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    expires_at: int


async def login_with_password(email: str, password: str) -> AuthSession:
    """Perform a password grant request against Supabase."""

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise AuthenticationError("Supabase n'est pas configuré côté serveur.")

    payload = {"email": email, "password": password}
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:  # pragma: no cover - network layer
        logger.error("Supabase login unreachable: %s", exc)
        raise AuthenticationError("Impossible de contacter le service d'authentification.") from exc

    try:
        data = response.json()
    except ValueError:
        data = None

    if response.status_code in (400, 401):
        message = (data or {}).get("error_description") or "Identifiants incorrects."
        raise InvalidCredentials(message)

    if response.status_code >= 500:
        logger.error("Supabase login failed (%s): %s", response.status_code, data)
        raise AuthenticationError("Le service d'authentification est momentanément indisponible.")

    if not response.is_success or not isinstance(data, dict):
        detail = (data or {}).get("error_description") or "Impossible de vérifier vos identifiants."
        raise AuthenticationError(detail)

    required_fields = ("access_token", "refresh_token", "token_type", "expires_in")
    missing = [field for field in required_fields if field not in data]
    if missing:
        logger.error("Supabase login response missing fields: %s", missing)
        raise AuthenticationError("Réponse Supabase invalide.")

    try:
        expires_in = int(data.get("expires_in") or 0)
    except (TypeError, ValueError):
        raise AuthenticationError("Durée d'expiration Supabase invalide.")

    raw_expires_at = data.get("expires_at")
    try:
        expires_at = int(raw_expires_at) if raw_expires_at is not None else int(time.time()) + expires_in
    except (TypeError, ValueError):
        expires_at = int(time.time()) + expires_in

    return AuthSession(
        access_token=str(data["access_token"]),
        refresh_token=str(data["refresh_token"]),
        token_type=str(data.get("token_type") or "bearer"),
        expires_in=expires_in,
        expires_at=expires_at,
    )


__all__ = ["login_with_password", "AuthSession", "AuthenticationError", "InvalidCredentials"]
