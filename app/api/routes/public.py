import asyncio
import logging
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Request
from httpx import HTTPError as HttpxError
from postgrest import APIError as PostgrestAPIError
from openai import APIError

from app.schemas import PublicRestaurantResponse, MenuUploadResponse
from app.services.postgrest_client import (
    create_postgrest_client,
    extract_bearer_token,
    raise_postgrest_error,
)
from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
from app.services.menu_ingest_service import (
    MenuExtractionError,
    build_menu_document_from_upload,
    build_menu_document_from_multiple_uploads,
)
from app.security.guards import enforce_same_origin, rate_limit_request

router = APIRouter()
logger = logging.getLogger(__name__)

async def _fetch_public_restaurant(
    *, restaurant_id: Optional[str] = None, slug: Optional[str] = None
) -> Dict[str, Any]:
    token = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
    if not token:
        raise HTTPException(status_code=503, detail="Consultation des restaurants indisponible.")

    if not restaurant_id and not slug:
        raise HTTPException(status_code=400, detail="Identifiant restaurant obligatoire.")

    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(token) as client:
            query = client.table("restaurants").select("id,display_name,slug,menu_document")
            if restaurant_id:
                query = query.eq("id", str(restaurant_id))
            elif slug:
                query = query.eq("slug", slug)
            response = query.limit(1).execute()
            return response.data or []

    try:
        rows = await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:
        raise_postgrest_error(exc, context="public restaurant lookup")
    except HttpxError as exc:
        logger.error("Supabase unreachable during public restaurant lookup: %s", exc)
        raise HTTPException(status_code=503, detail="Impossible de joindre Supabase.") from exc

    if not rows:
        raise HTTPException(status_code=404, detail="Restaurant introuvable.")
    return rows[0]


def _parse_menu_document(raw_document: Any) -> Dict[str, Any]:
    if isinstance(raw_document, dict):
        return raw_document
    if isinstance(raw_document, str) and raw_document.strip():
        try:
            return json.loads(raw_document)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Menu JSON invalide.") from exc
    raise HTTPException(status_code=422, detail="Menu non configuré pour ce restaurant.")


@router.get("/public/restaurants/{restaurant_id}", response_model=PublicRestaurantResponse)
async def public_restaurant_details(restaurant_id: UUID) -> PublicRestaurantResponse:
    record = await _fetch_public_restaurant(restaurant_id=str(restaurant_id))
    menu_document = _parse_menu_document(record.get("menu_document"))
    identifier = record.get("id") or str(restaurant_id)
    try:
        resolved_id = UUID(str(identifier))
    except (TypeError, ValueError):
        raise HTTPException(status_code=500, detail="Identifiant restaurant invalide.")

    return PublicRestaurantResponse(
        id=resolved_id,
        display_name=record.get("display_name") or record.get("name"),
        name=record.get("name"),
        slug=record.get("slug"),
        menu_document=menu_document,
    )


@router.post("/restaurants/menu/from-upload", response_model=MenuUploadResponse)
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
    except APIError as exc:
        logger.error("Menu upload parsing failed: %s", exc)
        raise HTTPException(status_code=502, detail="Erreur lors de l'analyse par l'IA.") from exc
    except Exception as exc:
        logger.exception("Unexpected menu upload failure")
        raise HTTPException(status_code=500, detail="Erreur inattendue lors du traitement du menu.") from exc

    return MenuUploadResponse(menu_document=document)


@router.post("/restaurants/menu/from-multiple-uploads", response_model=MenuUploadResponse)
async def menu_from_multiple_uploads(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    files: List[UploadFile] = File(...),
) -> MenuUploadResponse:
    """Upload and analyze multiple menu images/PDFs, merging them into a single menu document."""
    extract_bearer_token(authorization)
    
    if not files:
        raise HTTPException(status_code=400, detail="Aucun fichier fourni.")
    
    if len(files) > 5:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas uploader plus de 5 fichiers à la fois.")
    
    # Read all files
    file_data = []
    for file in files:
        data = await file.read()
        file_data.append((file.filename or "menu", file.content_type, data))
    
    try:
        document = await build_menu_document_from_multiple_uploads(file_data)
    except MenuExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except APIError as exc:
        logger.error("Multiple menu upload parsing failed: %s", exc)
        raise HTTPException(status_code=502, detail="Erreur lors de l'analyse par l'IA.") from exc
    except Exception as exc:
        logger.exception("Unexpected multiple menu upload failure")
        raise HTTPException(status_code=500, detail="Erreur inattendue lors du traitement des menus.") from exc

    return MenuUploadResponse(menu_document=document)


@router.post("/signup/menu/from-upload", response_model=MenuUploadResponse)
async def menu_from_upload_signup(request: Request, file: UploadFile = File(...)) -> MenuUploadResponse:
    enforce_same_origin(request)
    rate_limit_request(request, scope="menu-upload", limit=3, window_seconds=60)
    data = await file.read()
    try:
        document = await build_menu_document_from_upload(
            filename=file.filename or "menu",
            content_type=file.content_type,
            data=data,
        )
    except MenuExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except APIError as exc:
        logger.error("Menu upload parsing failed (signup): %s", exc)
        raise HTTPException(status_code=502, detail="Erreur lors de l'analyse par l'IA.") from exc
    except Exception as exc:
        logger.exception("Unexpected menu upload failure during signup")
        raise HTTPException(status_code=500, detail="Erreur inattendue lors du traitement du menu.") from exc

    return MenuUploadResponse(menu_document=document)
