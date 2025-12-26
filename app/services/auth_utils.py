"""Helpers for working with Supabase access tokens."""

from __future__ import annotations

import base64
import json
from typing import Any, Dict

from fastapi import HTTPException


def decode_access_token(access_token: str) -> Dict[str, Any]:
    """Return the decoded JWT payload for a Supabase access token."""

    if not access_token:
        raise HTTPException(status_code=401, detail="Authentification requise.")

    try:
        payload_segment = access_token.split(".")[1]
        padding = "=" * (-len(payload_segment) % 4)
        decoded = base64.urlsafe_b64decode((payload_segment + padding).encode("ascii"))
        return json.loads(decoded.decode("utf-8"))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=401, detail="Jeton d'authentification invalide.") from exc


__all__ = ["decode_access_token"]
