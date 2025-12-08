"""Ingredient categories API endpoints for managing stock thresholds."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from httpx import HTTPError as HttpxError
from pydantic import BaseModel, Field
from postgrest import APIError as PostgrestAPIError

from app.config.supabase_client import SUPABASE_SERVICE_ROLE_KEY
from app.services.postgrest_client import (
    create_postgrest_client,
    extract_bearer_token,
    raise_postgrest_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingredient-categories", tags=["Ingredient Categories"])


class IngredientCategoryResponse(BaseModel):
    id: UUID
    restaurant_id: UUID
    name: str
    description: str | None = None
    critical_threshold: float
    low_threshold: float
    ok_threshold: float


class UpdateThresholdsRequest(BaseModel):
    critical_threshold: float = Field(..., ge=0, le=1)
    low_threshold: float = Field(..., ge=0, le=2)
    ok_threshold: float = Field(..., ge=0)


@router.get("", response_model=List[IngredientCategoryResponse])
async def fetch_categories(
    restaurant_id: UUID,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> List[IngredientCategoryResponse]:
    """Fetch all ingredient categories for a restaurant."""
    
    access_token = extract_bearer_token(authorization)

    
    def _request() -> List[Dict[str, Any]]:
        with create_postgrest_client(
            SUPABASE_SERVICE_ROLE_KEY or access_token,
            api_key=SUPABASE_SERVICE_ROLE_KEY,
        ) as client:
            response = (
                client.table("ingredient_categories")
                .select("*")
                .eq("restaurant_id", str(restaurant_id))
                .order("name")
                .execute()
            )
            return response.data or []

    try:
        records = await asyncio.to_thread(_request)
        return [IngredientCategoryResponse(**record) for record in records]
    except PostgrestAPIError as exc:
        raise_postgrest_error(exc, context="fetch ingredient categories")
    except HttpxError as exc:
        raise HTTPException(
            status_code=503, detail="Supabase est temporairement inaccessible."
        ) from exc


@router.patch("/{category_id}/thresholds")
async def update_category_thresholds(
    category_id: UUID,
    payload: UpdateThresholdsRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> IngredientCategoryResponse:
    """Update stock thresholds for a specific category."""
    
    access_token = extract_bearer_token(authorization)
    
    def _request() -> Dict[str, Any]:
        with create_postgrest_client(
            SUPABASE_SERVICE_ROLE_KEY or access_token,
            api_key=SUPABASE_SERVICE_ROLE_KEY,
            prefer="return=representation",
        ) as client:
            response = (
                client.table("ingredient_categories")
                .update({
                    "critical_threshold": payload.critical_threshold,
                    "low_threshold": payload.low_threshold,
                    "ok_threshold": payload.ok_threshold,
                })
                .eq("id", str(category_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(status_code=404, detail="Catégorie non trouvée.")
            return response.data[0]

    try:
        record = await asyncio.to_thread(_request)
        return IngredientCategoryResponse(**record)
    except PostgrestAPIError as exc:
        raise_postgrest_error(exc, context="update category thresholds")
    except HttpxError as exc:
        raise HTTPException(
            status_code=503, detail="Supabase est temporairement inaccessible."
        ) from exc


__all__ = ["router"]
