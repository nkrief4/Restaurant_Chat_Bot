"""Business logic powering the dashboard API."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import HTTPException
from httpx import HTTPError as HttpxError
from postgrest import APIError as PostgrestAPIError

from app.services.postgrest_client import (
    create_postgrest_client,
    raise_postgrest_error,
)

logger = logging.getLogger(__name__)

QUESTION_KEYWORDS: Dict[str, Sequence[str]] = {
    "Options végétariennes": ("vegetar", "vegan", "sans viande"),
    "Allergènes": ("allerg", "sans gluten", "arach", "intol"),
    "Horaires": ("horaire", "ouverture", "service", "heures"),
    "Groupes": ("groupe", "privatisation", "évènement", "evenement"),
    "Réservations": ("reservation", "reserver", "table"),
}

PLAN_PRESETS: Dict[str, Dict[str, Any]] = {
    "Plan Découverte": {
        "description": "Accès essentiel pour tester RestauBot sur un établissement.",
        "price": 89,
        "currency": "EUR",
        "billing_cycle": "mensuel",
    },
    "Plan Pro": {
        "description": "Plan complet incluant statistiques avancées et support prioritaire.",
        "price": 189,
        "currency": "EUR",
        "billing_cycle": "mensuel",
    },
    "Plan Premium": {
        "description": "Multi-sites avec intégrations personnalisées et succès client dédié.",
        "price": 289,
        "currency": "EUR",
        "billing_cycle": "mensuel",
    },
}

DEFAULT_TIMEZONE = "Europe/Paris"


async def build_dashboard_snapshot(access_token: str) -> Dict[str, Any]:
    """Aggregate all the data needed by the dashboard."""

    claims = _decode_claims(access_token)
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Utilisateur Supabase invalide.")

    profile = await _ensure_profile(access_token, user_id, claims)
    tenant = await _fetch_tenant(access_token, user_id)
    tenant_id = tenant.get("id") if tenant else None
    restaurants = await _fetch_restaurants(access_token, tenant_id)
    chat_rows = await _fetch_chat_history(access_token, [r["id"] for r in restaurants])

    kpis = _build_kpis(profile, restaurants, chat_rows)
    statistics = _build_statistics(restaurants, chat_rows)
    billing = _build_billing_summary(profile, restaurants, kpis)

    return {
        "user": _build_user_payload(claims, profile),
        "tenant": tenant,
        "restaurants": restaurants,
        "kpis": kpis,
        "statistics": statistics,
        "billing": billing,
        "profile": _build_profile_payload(profile, claims),
    }


async def create_restaurant(access_token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Create a restaurant linked to the caller tenant."""

    claims = _decode_claims(access_token)
    user_id = claims.get("sub")
    tenant = await _fetch_tenant(access_token, user_id)
    if not tenant:
        raise HTTPException(status_code=400, detail="Aucun tenant associé à ce compte.")

    body = {
        "tenant_id": tenant["id"],
        "display_name": (payload.get("display_name") or "").strip(),
        "slug": (payload.get("slug") or "").strip(),
        "menu_document": payload.get("menu_document"),
    }
    record = await _persist_restaurant(access_token, body)
    return record


async def update_restaurant(access_token: str, restaurant_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Update an existing restaurant owned by the caller tenant."""

    claims = _decode_claims(access_token)
    user_id = claims.get("sub")
    tenant = await _fetch_tenant(access_token, user_id)
    if not tenant:
        raise HTTPException(status_code=400, detail="Aucun tenant associé à ce compte.")

    def _request() -> Dict[str, Any]:
        with create_postgrest_client(access_token, prefer="return=representation") as client:
            response = (
                client.table("restaurants")
                .update(
                    {
                        "display_name": (payload.get("display_name") or "").strip(),
                        "slug": (payload.get("slug") or "").strip(),
                        "menu_document": payload.get("menu_document"),
                    }
                )
                .eq("id", restaurant_id)
                .eq("tenant_id", tenant["id"])
                .limit(1)
                .execute()
            )
            if not response.data:
                raise HTTPException(status_code=404, detail="Restaurant introuvable.")
            return _normalize_restaurant_record(response.data[0])

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="restaurant update")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during restaurant update: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


async def update_profile(access_token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Update the caller profile with provided fields."""

    claims = _decode_claims(access_token)
    user_id = claims.get("sub")
    allowed_fields = {"full_name", "company_name", "country", "timezone"}
    update_body = {k: (v or "").strip() for k, v in payload.items() if k in allowed_fields}
    if not update_body:
        raise HTTPException(status_code=400, detail="Aucune donnée à mettre à jour.")

    def _request() -> Dict[str, Any]:
        with create_postgrest_client(access_token, prefer="return=representation") as client:
            response = (
                client.table("profiles")
                .update(update_body)
                .eq("id", user_id)
                .limit(1)
                .execute()
            )
            if response.data:
                return response.data[0]
            # fallback to insert if profile was missing
            insert_payload = {
                "id": user_id,
                **update_body,
            }
            insert_response = client.table("profiles").insert(insert_payload).execute()
            if not insert_response.data:
                return insert_payload
            return insert_response.data[0]

    try:
        record = await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="profile update")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during profile update: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    return _build_profile_payload(record, claims)


async def _persist_restaurant(access_token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    def _request() -> Dict[str, Any]:
        with create_postgrest_client(access_token, prefer="return=representation") as client:
            response = client.table("restaurants").insert(payload).execute()
            if not response.data:
                raise HTTPException(status_code=500, detail="Création du restaurant impossible.")
            return _normalize_restaurant_record(response.data[0])

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="restaurant creation")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during restaurant creation: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


async def _ensure_profile(access_token: str, user_id: str, claims: Dict[str, Any]) -> Dict[str, Any]:
    existing = await _fetch_profile(access_token, user_id)
    if existing:
        return existing
    username = (claims.get("email") or claims.get("user_email") or "utilisateur").split("@")[0]
    insert_payload = {
        "id": user_id,
        "username": username,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    def _request() -> Dict[str, Any]:
        with create_postgrest_client(access_token, prefer="return=representation") as client:
            response = client.table("profiles").insert(insert_payload).execute()
            if response.data:
                return response.data[0]
            return insert_payload

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="profile creation")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during profile creation: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


def _decode_claims(access_token: str) -> Dict[str, Any]:
    try:
        payload_segment = access_token.split(".")[1]
        padding = "=" * (-len(payload_segment) % 4)
        decoded = base64.urlsafe_b64decode((payload_segment + padding).encode("ascii"))
        return json.loads(decoded.decode("utf-8"))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=401, detail="Jeton d'authentification invalide.") from exc


async def _fetch_profile(access_token: str, user_id: str) -> Optional[Dict[str, Any]]:
    def _request() -> Optional[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
            return response.data[0] if response.data else None

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="profile lookup")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during profile lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


async def _fetch_tenant(access_token: str, user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None

    def _request() -> Optional[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("user_tenants")
                .select("tenant_id")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            if not response.data:
                return None
            row = response.data[0]
            tenant_id = row.get("tenant_id")
            if not tenant_id:
                return None
            return {"id": tenant_id}

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="tenant lookup")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during tenant lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


async def _fetch_restaurants(access_token: str, tenant_id: Optional[str]) -> List[Dict[str, Any]]:
    if not tenant_id:
        return []

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("restaurants")
                .select("id,display_name,slug,menu_document,created_at,updated_at")
                .eq("tenant_id", tenant_id)
                .order("created_at", desc=False)
                .execute()
            )
            rows = response.data or []
            return [_normalize_restaurant_record(row) for row in rows]

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="restaurants lookup")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during restaurants lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


async def _fetch_chat_history(access_token: str, restaurant_ids: Sequence[str], limit: int = 600) -> List[Dict[str, Any]]:
    if not restaurant_ids:
        return []

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("chat_history")
                .select("*")
                .in_("restaurant_id", list(restaurant_ids))
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data or []

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="chat history lookup")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during chat history lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


def _normalize_restaurant_record(record: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {**record}
    normalized["menu_document"] = _normalize_menu_document(record.get("menu_document"))
    return normalized


def _normalize_menu_document(value: Any) -> Optional[Dict[str, Any]]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def _build_user_payload(claims: Dict[str, Any], profile: Dict[str, Any]) -> Dict[str, Any]:
    full_name = profile.get("full_name") or claims.get("name")
    company_name = profile.get("company_name")
    plan = profile.get("plan") or profile.get("subscription_plan") or "Plan Pro"
    return {
        "id": claims.get("sub"),
        "email": claims.get("email") or claims.get("user_email"),
        "fullName": full_name,
        "company": company_name,
        "plan": plan,
    }


def _build_profile_payload(profile: Dict[str, Any], claims: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "full_name": profile.get("full_name") or claims.get("name") or "",
        "email": claims.get("email") or claims.get("user_email") or "",
        "company_name": profile.get("company_name") or "",
        "country": profile.get("country") or "",
        "timezone": profile.get("timezone") or DEFAULT_TIMEZONE,
        "plan": profile.get("plan") or profile.get("subscription_plan") or "Plan Pro",
    }


def _build_kpis(profile: Dict[str, Any], restaurants: List[Dict[str, Any]], chat_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)
    conversations_last_30 = 0
    unique_keys = set()
    for row in chat_rows:
        created = _parse_timestamp(row.get("created_at"))
        if created and created >= cutoff:
            conversations_last_30 += 1
        key = row.get("session_id") or f"{row.get('restaurant_id')}:{row.get('id')}"
        unique_keys.add(key)

    plan_name, plan_detail = _resolve_plan(profile)
    timeline = _build_timeline(chat_rows)
    busiest = _build_busiest(chat_rows, restaurants)

    return {
        "restaurants": len(restaurants),
        "conversations_last_30": conversations_last_30,
        "unique_customers": len(unique_keys) or len(chat_rows),
        "plan": plan_name,
        "plan_detail": plan_detail,
        "timeline": timeline,
        "busiest": busiest,
    }


def _build_statistics(restaurants: List[Dict[str, Any]], chat_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(chat_rows)
    average = round(total / 30, 1) if total else 0
    resolution_rate = _compute_resolution_rate(chat_rows)
    top_questions = _summarize_questions(chat_rows)
    diet_breakdown = _diet_breakdown(restaurants)

    return {
        "total_conversations": total,
        "average_per_day": average,
        "resolution_rate": resolution_rate,
        "top_questions": top_questions,
        "diet_breakdown": diet_breakdown,
    }


def _build_billing_summary(profile: Dict[str, Any], restaurants: List[Dict[str, Any]], kpis: Dict[str, Any]) -> Dict[str, Any]:
    plan_name, plan_detail = _resolve_plan(profile)
    preset = PLAN_PRESETS.get(plan_name, PLAN_PRESETS["Plan Découverte"])
    today = datetime.now(timezone.utc)
    next_payment = today.replace(day=1) + timedelta(days=35)
    next_payment = next_payment.replace(day=12)

    history = []
    for months_back in range(1, 4):
        entry_date = today - timedelta(days=30 * months_back)
        history.append(
            {
                "date": entry_date.date().isoformat(),
                "description": f"{plan_name} ({preset['billing_cycle']})",
                "amount": preset["price"],
                "currency": preset["currency"],
                "status": "paid",
            }
        )

    return {
        "plan": {
            "name": plan_name,
            "description": plan_detail,
            "price": preset["price"],
            "currency": preset["currency"],
        },
        "next_payment": next_payment.date().isoformat(),
        "usage": {
            "restaurants": len(restaurants),
            "conversations_last_30": kpis.get("conversations_last_30", 0),
        },
        "history": history,
    }


def _resolve_plan(profile: Dict[str, Any]) -> Tuple[str, str]:
    plan = profile.get("plan") or profile.get("subscription_plan") or "Plan Découverte"
    preset = PLAN_PRESETS.get(plan, PLAN_PRESETS["Plan Découverte"])
    return plan, preset["description"]


def _build_timeline(chat_rows: List[Dict[str, Any]], days: int = 14) -> List[Dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    buckets = Counter()
    for row in chat_rows:
        created = _parse_timestamp(row.get("created_at"))
        if not created:
            continue
        buckets[created.date()] += 1
    timeline = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        timeline.append({"label": day.strftime("%d/%m"), "count": buckets.get(day, 0)})
    return timeline


def _build_busiest(chat_rows: List[Dict[str, Any]], restaurants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapping = {restaurant["id"]: restaurant.get("display_name") or restaurant.get("name") for restaurant in restaurants}
    counts = Counter(row.get("restaurant_id") for row in chat_rows if row.get("restaurant_id"))
    busiest = []
    for restaurant_id, count in counts.most_common(3):
        busiest.append({"restaurant_id": restaurant_id, "name": mapping.get(restaurant_id, "Restaurant"), "count": count})
    return busiest


def _compute_resolution_rate(chat_rows: List[Dict[str, Any]]) -> float:
    if not chat_rows:
        return 0.0
    resolved = 0
    for row in chat_rows:
        assistant_reply = row.get("assistant_reply") or _extract_last_message(row, "assistant")
        if isinstance(assistant_reply, str) and assistant_reply.strip():
            resolved += 1
    return round((resolved / len(chat_rows)) * 100, 1)


def _summarize_questions(chat_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counter = Counter()
    for row in chat_rows:
        message = (row.get("user_message") or _extract_last_message(row, "user") or "").lower()
        if not message:
            continue
        matched = False
        for label, keywords in QUESTION_KEYWORDS.items():
            if any(keyword in message for keyword in keywords):
                counter[label] += 1
                matched = True
                break
        if not matched:
            counter["Autres"] += 1
    if not counter:
        return []
    return [{"label": label, "count": count} for label, count in counter.most_common(4)]


def _diet_breakdown(restaurants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tag_counter: Counter[str] = Counter()
    for restaurant in restaurants:
        document = restaurant.get("menu_document") or {}
        for category in document.get("categories", []):
            for item in category.get("items", []):
                for tag in item.get("tags", []):
                    tag_counter[tag.lower()] += 1
    return [
        {"label": label.title(), "count": count}
        for label, count in tag_counter.most_common(5)
    ]


def _extract_last_message(row: Dict[str, Any], role: str) -> str:
    messages = row.get("messages")
    if not messages:
        return ""
    parsed: Any = messages
    if isinstance(messages, str):
        try:
            parsed = json.loads(messages)
        except json.JSONDecodeError:
            return ""
    if not isinstance(parsed, list):
        return ""
    for entry in reversed(parsed):
        if not isinstance(entry, dict):
            continue
        if entry.get("role") == role:
            return entry.get("content") or ""
    return ""


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value.replace("Z", "+00:00")
        return datetime.fromisoformat(value)
    except ValueError:
        return None


__all__ = [
    "build_dashboard_snapshot",
    "create_restaurant",
    "update_profile",
    "update_restaurant",
]
