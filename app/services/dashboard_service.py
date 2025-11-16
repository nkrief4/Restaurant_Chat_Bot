"""Business logic powering the dashboard API."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from math import ceil
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


async def build_dashboard_snapshot(
    access_token: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Aggregate all the data needed by the dashboard."""

    claims = _decode_claims(access_token)
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Utilisateur Supabase invalide.")

    range_start, range_end = _resolve_date_range(start_date, end_date)
    profile = await _ensure_profile(access_token, user_id, claims)
    tenant = await _fetch_tenant(access_token, user_id)
    tenant_id = tenant.get("id") if tenant else None
    restaurants = await _fetch_restaurants(access_token, tenant_id)
    chat_rows = await _fetch_chat_history(access_token, [r["id"] for r in restaurants], range_start, range_end)
    chat_sessions = _group_chat_sessions(chat_rows)

    kpis = _build_kpis(profile, restaurants, chat_rows, chat_sessions, range_start, range_end)
    statistics = _build_statistics(
        restaurants,
        chat_rows,
        chat_sessions,
        range_start,
        range_end,
        busiest=kpis.get("busiest"),
    )
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


def _resolve_date_range(
    start_date: Optional[str],
    end_date: Optional[str],
) -> Tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    default_start = today - timedelta(days=29)
    default_end = today
    start_value = _parse_date_input(start_date) or default_start
    end_value = _parse_date_input(end_date) or default_end
    if start_value > end_value:
        start_value, end_value = end_value, start_value
    max_span = timedelta(days=365)
    if end_value - start_value > max_span:
        start_value = end_value - max_span
    range_start = datetime.combine(start_value, datetime.min.time(), tzinfo=timezone.utc)
    range_end = datetime.combine(end_value, datetime.max.time(), tzinfo=timezone.utc)
    return range_start, range_end


def _parse_date_input(value: Optional[str]) -> Optional[datetime.date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None


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


async def _fetch_chat_history(
    access_token: str,
    restaurant_ids: Sequence[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
) -> List[Dict[str, Any]]:
    if not restaurant_ids:
        return []

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            query = (
                client.table("chat_history")
                .select("*")
                .in_("restaurant_id", list(restaurant_ids))
            )
            if start_date:
                query = query.gte("created_at", _format_supabase_timestamp(start_date))
            if end_date:
                query = query.lte("created_at", _format_supabase_timestamp(end_date))
            response = query.order("created_at", desc=True).execute()
            return response.data or []

    try:
        return await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="chat history lookup")
    except HttpxError as exc:  # pragma: no cover - network interaction
        logger.error("Supabase unreachable during chat history lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


def _format_supabase_timestamp(value: datetime) -> str:
    normalized = value.astimezone(timezone.utc).replace(microsecond=0)
    return normalized.isoformat().replace("+00:00", "Z")


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


def _count_messages(chat_rows: List[Dict[str, Any]]) -> int:
    total = 0
    for row in chat_rows:
        prompt = _extract_user_prompt(row)
        if prompt:
            total += 1
            continue
        normalized = _normalize_messages(row.get("messages"))
        if normalized is not None:
            total += sum(1 for entry in normalized if entry.get("role") == "user")
    return total


def _normalize_messages(value: Any) -> Optional[List[Dict[str, Any]]]:
    if isinstance(value, list):
        return [entry for entry in value if isinstance(entry, dict)]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return [entry for entry in parsed if isinstance(entry, dict)]
    return None


def _extract_user_prompt(row: Dict[str, Any]) -> str:
    for key in ("user_prompt", "user_message"):
        message = row.get(key)
        if isinstance(message, str) and message.strip():
            return message
    return _extract_last_message(row, "user")


def _extract_assistant_reply(row: Dict[str, Any]) -> str:
    for key in ("ai_response", "assistant_reply"):
        message = row.get(key)
        if isinstance(message, str) and message.strip():
            return message
    return _extract_last_message(row, "assistant")


def _group_chat_sessions(chat_rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    sessions: Dict[str, Dict[str, Any]] = {}
    for row in chat_rows:
        session_id = _resolve_session_key(row)
        session = sessions.get(session_id)
        created = _parse_timestamp(row.get("created_at"))
        if not session:
            session = {
                "id": session_id,
                "restaurant_id": row.get("restaurant_id"),
                "created_at": created,
                "messages": 0,
                "resolved": False,
            }
            sessions[session_id] = session
        else:
            if created and (session.get("created_at") is None or created < session["created_at"]):
                session["created_at"] = created
        session["messages"] = session.get("messages", 0) + 1
        assistant_reply = _extract_assistant_reply(row)
        if isinstance(assistant_reply, str) and assistant_reply.strip():
            session["resolved"] = True
    return sessions


def _resolve_session_key(row: Dict[str, Any]) -> str:
    raw = row.get("session_id")
    if raw:
        return str(raw)
    restaurant_id = row.get("restaurant_id") or "restaurant"
    fallback = row.get("id") or row.get("created_at") or id(row)
    return f"{restaurant_id}:{fallback}"


def _build_kpis(
    profile: Dict[str, Any],
    restaurants: List[Dict[str, Any]],
    chat_rows: List[Dict[str, Any]],
    chat_sessions: Dict[str, Dict[str, Any]],
    start_date: datetime,
    end_date: datetime,
) -> Dict[str, Any]:
    total_conversations = len(chat_sessions)
    total_messages = _count_messages(chat_rows)
    plan_name, plan_detail = _resolve_plan(profile)
    timeline = _build_timeline(chat_sessions, start_date, end_date)
    busiest = _build_busiest(chat_sessions, restaurants)
    days_count = max(1, (end_date.date() - start_date.date()).days + 1)
    average_per_day = round(total_conversations / days_count, 1) if total_conversations else 0
    average_messages = round(total_messages / total_conversations, 1) if total_conversations else 0

    return {
        "restaurants": len(restaurants),
        "conversations": total_conversations,
        "messages": total_messages,
        "unique_customers": total_conversations or len(chat_rows),
        "plan": plan_name,
        "plan_detail": plan_detail,
        "timeline": timeline,
        "busiest": busiest,
        "average_per_day": average_per_day,
        "average_messages": average_messages,
        "date_range": {
            "start": start_date.date().isoformat(),
            "end": end_date.date().isoformat(),
        },
    }


def _build_statistics(
    restaurants: List[Dict[str, Any]],
    chat_rows: List[Dict[str, Any]],
    chat_sessions: Dict[str, Dict[str, Any]],
    start_date: datetime,
    end_date: datetime,
    *,
    busiest: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    total = len(chat_sessions)
    total_messages = _count_messages(chat_rows)
    days_count = max(1, (end_date.date() - start_date.date()).days + 1)
    average = round(total / days_count, 1) if total else 0
    avg_messages = round(total_messages / total, 1) if total else 0
    resolution_rate = _compute_resolution_rate(chat_sessions)
    top_questions = _summarize_questions(chat_rows)
    diet_breakdown = _diet_breakdown(restaurants)
    busiest_list = busiest if busiest is not None else _build_busiest(chat_sessions, restaurants)

    return {
        "total_conversations": total,
        "total_messages": total_messages,
        "average_per_day": average,
        "average_messages": avg_messages,
        "resolution_rate": resolution_rate,
        "top_questions": top_questions,
        "diet_breakdown": diet_breakdown,
        "busiest": busiest_list,
        "date_range": {
            "start": start_date.date().isoformat(),
            "end": end_date.date().isoformat(),
        },
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
            "conversations_last_30": kpis.get("conversations", 0),
        },
        "history": history,
    }


def _resolve_plan(profile: Dict[str, Any]) -> Tuple[str, str]:
    plan = profile.get("plan") or profile.get("subscription_plan") or "Plan Découverte"
    preset = PLAN_PRESETS.get(plan, PLAN_PRESETS["Plan Découverte"])
    return plan, preset["description"]


def _build_timeline(
    chat_sessions: Dict[str, Dict[str, Any]],
    start_date: datetime,
    end_date: datetime,
    max_points: int = 30,
) -> List[Dict[str, Any]]:
    buckets = Counter()
    for session in chat_sessions.values():
        created = session.get("created_at")
        if isinstance(created, str):
            created = _parse_timestamp(created)
        if not isinstance(created, datetime):
            continue
        buckets[created.date()] += 1

    start_day = start_date.date()
    end_day = end_date.date()
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    total_days = max(1, (end_day - start_day).days + 1)
    step = max(1, ceil(total_days / max_points))

    timeline: List[Dict[str, Any]] = []
    current = start_day
    while current <= end_day:
        window_end = min(end_day, current + timedelta(days=step - 1))
        count = 0
        cursor = current
        while cursor <= window_end:
            count += buckets.get(cursor, 0)
            cursor += timedelta(days=1)
        label = current.strftime("%d/%m")
        if window_end > current:
            label = f"{current.strftime('%d/%m')}–{window_end.strftime('%d/%m')}"
        timeline.append({"label": label, "count": count})
        current = window_end + timedelta(days=1)
    return timeline


def _build_busiest(
    chat_sessions: Dict[str, Dict[str, Any]],
    restaurants: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    mapping = {restaurant["id"]: restaurant.get("display_name") or restaurant.get("name") for restaurant in restaurants}
    counts: Counter[str] = Counter()
    for session in chat_sessions.values():
        restaurant_id = session.get("restaurant_id")
        if restaurant_id:
            counts[str(restaurant_id)] += 1
    busiest = []
    for restaurant_id, count in counts.most_common(3):
        busiest.append({"restaurant_id": restaurant_id, "name": mapping.get(restaurant_id, "Restaurant"), "count": count})
    return busiest


def _compute_resolution_rate(chat_sessions: Dict[str, Dict[str, Any]]) -> float:
    if not chat_sessions:
        return 0.0
    resolved = sum(1 for session in chat_sessions.values() if session.get("resolved"))
    return round((resolved / len(chat_sessions)) * 100, 1)


def _summarize_questions(chat_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counter = Counter()
    for row in chat_rows:
        message = (_extract_user_prompt(row) or "").lower()
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
