"""FastAPI application exposing chat endpoint and serving static frontend."""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

sys.path.append(str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from httpx import HTTPError as HttpxError
from postgrest import APIError as PostgrestAPIError
from pydantic import BaseModel, EmailStr, Field
from openai import APIError

from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_URL
from app.services.chat_service import get_chat_response
from app.services.dashboard_service import (
    build_dashboard_snapshot,
    create_restaurant as dashboard_create_restaurant,
    update_profile as dashboard_update_profile,
    update_restaurant as dashboard_update_restaurant,
)
from app.services.menu_ingest_service import (
    MenuExtractionError,
    build_menu_document_from_upload,
)
from app.services.signup_service import (
    SignupError,
    SignupPayload,
    SignupValidationError,
    execute_signup,
)
from app.services.postgrest_client import (
    create_postgrest_client,
    extract_bearer_token,
    postgrest_status,
    raise_postgrest_error,
)

app = FastAPI(title="Restaurant Chatbot")
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
INDEX_FILE = STATIC_DIR / "index.html"
LOGIN_FILE = STATIC_DIR / "login.html"
SIGNUP_FILE = STATIC_DIR / "signup.html"
DASHBOARD_FILE = STATIC_DIR / "dashboard.html"
CHAT_FILE = STATIC_DIR / "chat.html"

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatMessagePayload(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    restaurant_id: UUID
    message: str
    history: List[ChatMessagePayload] = Field(default_factory=list)


class MenuUploadResponse(BaseModel):
    menu_document: Dict[str, Any]


class SignupSuccessResponse(BaseModel):
    message: str
    email: EmailStr
    tenant_id: UUID
    restaurant_id: UUID
    auto_login: bool = True


class RestaurantUpsertPayload(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=120, description="Nom public du restaurant")
    slug: str = Field(..., min_length=2, max_length=120, description="Identifiant unique utilisé pour le partage")
    menu_document: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Menu structuré optionnel",
    )


class ProfileUpdatePayload(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)
    country: Optional[str] = Field(default=None, max_length=120)
    timezone: Optional[str] = Field(default=None, max_length=64)


@app.get("/", response_class=FileResponse)
def read_index() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/login", response_class=FileResponse)
def read_login() -> FileResponse:
    return FileResponse(LOGIN_FILE)


@app.get("/signup", response_class=FileResponse)
def read_signup() -> FileResponse:
    return FileResponse(SIGNUP_FILE)


@app.get("/dashboard", response_class=FileResponse)
def read_dashboard() -> FileResponse:
    return FileResponse(DASHBOARD_FILE)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat")
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
    reply = await get_chat_response(
        request.message,
        history,
        restaurant_name=restaurant_name,
        menu_document=menu_document,
    )

    conversation_history = [*history]
    conversation_history.append({"role": "user", "content": request.message.strip()})
    conversation_history.append({"role": "assistant", "content": reply})
    await _insert_chat_history(
        restaurant_id=str(request.restaurant_id),
        access_token=bearer_token,
        user_message=request.message.strip(),
        assistant_reply=reply,
        history=conversation_history,
    )

    return {"reply": reply}


@app.get("/api/config")
def supabase_config() -> Dict[str, str]:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase configuration missing.")
    return {"supabaseUrl": SUPABASE_URL, "supabaseAnonKey": SUPABASE_ANON_KEY}


@app.post("/api/auth/signup", response_model=SignupSuccessResponse)
async def signup_endpoint(payload: SignupPayload) -> SignupSuccessResponse:
    try:
        result = await execute_signup(payload)
    except SignupValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SignupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        tenant_uuid = UUID(result.tenant_id)
        restaurant_uuid = UUID(result.restaurant_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Identifiants Supabase invalides.") from exc

    return SignupSuccessResponse(
        message="Votre espace restaurateur est prêt. Vous pouvez accéder au tableau de bord.",
        email=payload.email,
        tenant_id=tenant_uuid,
        restaurant_id=restaurant_uuid,
    )


@app.get("/chat", include_in_schema=False)
def deprecated_chat() -> None:
    raise HTTPException(status_code=404, detail="Le chatbot est disponible depuis le dashboard.")


@app.get("/dashboard/chat", response_class=FileResponse)
@app.get("/dashboard/chat.html", response_class=FileResponse)
def read_dashboard_chat() -> FileResponse:
    return FileResponse(CHAT_FILE)


@app.post("/api/restaurants/menu/from-upload", response_model=MenuUploadResponse)
async def menu_from_upload(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    file: UploadFile = File(...),
) -> MenuUploadResponse:
    extract_bearer_token(authorization)
    data = await file.read()
    try:
        document = await build_menu_document_from_upload(
            filename=file.filename or "menu",
            content_type=file.content_type,
            data=data,
        )
    except MenuExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except APIError as exc:  # pragma: no cover - depends on OpenAI availability
        logger.error("Menu upload parsing failed: %s", exc)
        raise HTTPException(status_code=502, detail="Erreur lors de l'analyse par l'IA.") from exc
    except Exception as exc:  # pragma: no cover - unexpected errors
        logger.exception("Unexpected menu upload failure")
        raise HTTPException(status_code=500, detail="Erreur inattendue lors du traitement du menu.") from exc

    return MenuUploadResponse(menu_document=document)


@app.post("/api/signup/menu/from-upload", response_model=MenuUploadResponse)
async def menu_from_upload_signup(file: UploadFile = File(...)) -> MenuUploadResponse:
    data = await file.read()
    try:
        document = await build_menu_document_from_upload(
            filename=file.filename or "menu",
            content_type=file.content_type,
            data=data,
        )
    except MenuExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except APIError as exc:  # pragma: no cover - depends on OpenAI availability
        logger.error("Menu upload parsing failed (signup): %s", exc)
        raise HTTPException(status_code=502, detail="Erreur lors de l'analyse par l'IA.") from exc
    except Exception as exc:  # pragma: no cover - unexpected errors
        logger.exception("Unexpected menu upload failure during signup")
        raise HTTPException(status_code=500, detail="Erreur inattendue lors du traitement du menu.") from exc

    return MenuUploadResponse(menu_document=document)


@app.get("/api/dashboard/snapshot")
async def dashboard_snapshot_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await build_dashboard_snapshot(token)


@app.post("/api/dashboard/restaurants")
async def dashboard_restaurant_create(
    payload: RestaurantUpsertPayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_create_restaurant(token, payload.model_dump())


@app.put("/api/dashboard/restaurants/{restaurant_id}")
async def dashboard_restaurant_update(
    restaurant_id: UUID,
    payload: RestaurantUpsertPayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_update_restaurant(token, str(restaurant_id), payload.model_dump())


@app.put("/api/dashboard/profile")
async def dashboard_profile_update(
    payload: ProfileUpdatePayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_update_profile(token, payload.model_dump(exclude_none=True))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)


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
    except PostgrestAPIError as exc:  # pragma: no cover - depends on network
        raise_postgrest_error(exc, context="restaurant lookup")
    except HttpxError as exc:  # pragma: no cover - network interactions
        logger.error("Supabase restaurant lookup unreachable: %s", exc)
        raise HTTPException(status_code=503, detail="Impossible de joindre Supabase.")

    if not rows:
        raise HTTPException(status_code=404, detail="Restaurant introuvable ou inaccessible.")
    return rows[0]


async def _insert_chat_history(
    *,
    restaurant_id: str,
    access_token: str,
    user_message: str,
    assistant_reply: str,
    history: List[Dict[str, str]],
) -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return

    def _request() -> None:
        with create_postgrest_client(access_token, prefer="return=minimal") as client:
            client.table("chat_history").insert(
                {
                    "restaurant_id": restaurant_id,
                    "user_message": user_message,
                    "assistant_reply": assistant_reply,
                    "messages": history,
                }
            ).execute()

    try:
        await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - depends on network
        status = postgrest_status(exc)
        if status in (401, 403):
            raise_postgrest_error(exc, context="chat history insert")
        logger.warning("Chat history insert failed (%s): %s", status, exc.message)
    except HttpxError as exc:  # pragma: no cover - network interactions
        logger.warning("Chat history insert unreachable: %s", exc)


def _parse_menu_document(raw_document: Any) -> Dict[str, Any]:
    if isinstance(raw_document, dict):
        return raw_document
    if isinstance(raw_document, str) and raw_document.strip():
        try:
            return json.loads(raw_document)
        except json.JSONDecodeError as exc:  # pragma: no cover - depends on DB content
            raise HTTPException(status_code=422, detail="Menu JSON invalide.") from exc
    raise HTTPException(status_code=422, detail="Menu non configuré pour ce restaurant.")
