"""Reusable security helpers for authentication endpoints."""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, DefaultDict

from fastapi import HTTPException, Request


def _normalize_origin(value: str) -> str:
    return value.rstrip("/").lower()


TRUSTED_ORIGINS = tuple(
    _normalize_origin(entry)
    for entry in os.getenv("TRUSTED_ORIGINS", "").split(",")
    if entry.strip()
)

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: DefaultDict[str, Deque[float]] = defaultdict(deque)


def get_client_ip(request: Request) -> str:
    """Best effort extraction of the requester IP address."""

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        candidate = forwarded.split(",")[0].strip()
        if candidate:
            return candidate
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_same_origin(request: Request) -> None:
    """Block cross-site form posts unless explicitly allowed."""

    origin = request.headers.get("origin")
    if not origin:
        return
    normalized_origin = _normalize_origin(origin)
    if normalized_origin in TRUSTED_ORIGINS:
        return
    host = request.headers.get("host")
    scheme = request.url.scheme or "http"
    if host:
        expected = _normalize_origin(f"{scheme}://{host}")
        if normalized_origin == expected:
            return
    raise HTTPException(status_code=403, detail="Origine de la requête non autorisée.")


def rate_limit_request(
    request: Request,
    *,
    scope: str,
    limit: int,
    window_seconds: int,
) -> None:
    """Apply an in-memory token bucket per client IP and scope."""

    identifier = f"{scope}:{get_client_ip(request)}"
    now = time.monotonic()
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[identifier]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez plus tard.")
        bucket.append(now)


__all__ = ["enforce_same_origin", "rate_limit_request", "get_client_ip"]
