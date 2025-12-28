import asyncio
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from postgrest import APIError as PostgrestAPIError
from httpx import HTTPError as HttpxError
import logging
import json
import base64

from app.schemas import ChatRequest
from app.services.chat_service import get_chat_response, _extract_dietary_constraints
from app.services.postgrest_client import (
    create_postgrest_client,
    extract_bearer_token,
    postgrest_status,
    raise_postgrest_error,
)
from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_URL

router = APIRouter()
logger = logging.getLogger(__name__)

async def _fetch_restaurant(restaurant_id: UUID, access_token: str) -> Dict[str, Any]:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase configuration missing.")

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("restaurants")
                .select("id,display_name,menu_document")
                .eq("id", str(restaurant_id))
                .limit(1)
                .execute()
            )
            return response.data or []

    try:
        rows = await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:
        raise_postgrest_error(exc, context="restaurant lookup")
    except HttpxError as exc:
        logger.error("Supabase restaurant lookup unreachable: %s", exc)
        raise HTTPException(status_code=503, detail="Impossible de joindre Supabase.")

    if not rows:
        raise HTTPException(status_code=404, detail="Restaurant introuvable ou inaccessible.")
    return rows[0]


async def _fetch_session_history(session_id: str, access_token: str) -> List[Dict[str, str]]:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return []

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("chat_history")
                .select("user_prompt,ai_response,created_at")
                .eq("session_id", session_id)
                .order("created_at", desc=False)
                .limit(20)
                .execute()
            )
            return response.data or []

    try:
        rows = await asyncio.to_thread(_request)
    except PostgrestAPIError:
        return []
    except HttpxError:
        return []

    messages: List[Dict[str, str]] = []
    for row in rows:
        user_prompt = (row.get("user_prompt") or "").strip()
        if user_prompt:
            messages.append({"role": "user", "content": user_prompt})
        ai_response = (row.get("ai_response") or "").strip()
        if ai_response:
            messages.append({"role": "assistant", "content": ai_response})
    return messages


def _parse_menu_document(raw_document: Any) -> Dict[str, Any]:
    if isinstance(raw_document, dict):
        return raw_document
    if isinstance(raw_document, str) and raw_document.strip():
        try:
            return json.loads(raw_document)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Menu JSON invalide.") from exc
    raise HTTPException(status_code=422, detail="Menu non configuré pour ce restaurant.")


def _extract_user_id(access_token: Optional[str]) -> Optional[str]:
    if not access_token:
        return None
    try:
        payload_segment = access_token.split(".")[1]
        padding = "=" * (-len(payload_segment) % 4)
        decoded = base64.urlsafe_b64decode((payload_segment + padding).encode("ascii"))
        data = json.loads(decoded.decode("utf-8"))
        return data.get("sub")
    except Exception:
        return None


async def _insert_chat_history(
    *,
    restaurant_id: str,
    access_token: str,
    user_message: str,
    assistant_reply: str,
    session_id: Optional[str],
    user_id: Optional[str],
) -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return

    resolved_session_id = session_id or str(uuid4())

    payload: Dict[str, Any] = {
        "restaurant_id": restaurant_id,
        "session_id": resolved_session_id,
        "user_prompt": user_message,
        "ai_response": assistant_reply,
    }
    if user_id:
        payload["user_id"] = user_id

    def _request() -> None:
        with create_postgrest_client(access_token, prefer="return=minimal") as client:
            client.table("chat_history").insert(payload).execute()

    try:
        await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:
        status = postgrest_status(exc)
        if status in (401, 403):
            raise_postgrest_error(exc, context="chat history insert")
        logger.warning("Chat history insert failed (%s): %s", status, exc.message)
    except HttpxError as exc:
        logger.warning("Chat history insert unreachable: %s", exc)


@router.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, str]:
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Le message ne peut pas être vide.")

    bearer_token = extract_bearer_token(authorization)
    restaurant = await _fetch_restaurant(request.restaurant_id, bearer_token)
    menu_document = _parse_menu_document(restaurant.get("menu_document"))
    restaurant_name = restaurant.get("display_name") or "Restaurant"

    history = [{"role": entry.role, "content": entry.content} for entry in request.history]
    session_history: List[Dict[str, str]] = []
    if request.session_id:
        session_history = await _fetch_session_history(str(request.session_id), bearer_token)
        if not history:
            history = session_history
    persisted_constraints = _extract_dietary_constraints(session_history) if session_history else None
    reply = await get_chat_response(
        request.message,
        history,
        restaurant_name=restaurant_name,
        menu_document=menu_document,
        persisted_constraints=persisted_constraints,
    )
    await _insert_chat_history(
        restaurant_id=str(request.restaurant_id),
        access_token=bearer_token,
        user_message=request.message.strip(),
        assistant_reply=reply,
        session_id=str(request.session_id) if request.session_id else None,
        user_id=_extract_user_id(bearer_token),
    )

    return {"reply": reply}
