from typing import Any, Dict, List, Optional, Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query

from app.schemas import RestaurantUpsertPayload, ProfileUpdatePayload
from app.services.dashboard_service import (
    build_dashboard_snapshot,
    build_statistics_view,
    create_restaurant as dashboard_create_restaurant,
    list_dashboard_restaurants,
    update_profile as dashboard_update_profile,
    update_restaurant as dashboard_update_restaurant,
)
from app.services.postgrest_client import extract_bearer_token

router = APIRouter()

@router.get("/snapshot")
async def dashboard_snapshot_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await build_dashboard_snapshot(token, start_date=start_date, end_date=end_date)


@router.get("/statistics")
async def dashboard_statistics_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    restaurant_id: Annotated[Optional[List[str]], Query(alias="restaurant_id")] = None,
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await build_statistics_view(
        token,
        start_date=start_date,
        end_date=end_date,
        restaurant_ids=restaurant_id,
    )


@router.get("/restaurants")
async def dashboard_restaurants_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    records = await list_dashboard_restaurants(token)
    return {"restaurants": records}


@router.post("/restaurants")
async def dashboard_restaurant_create(
    payload: RestaurantUpsertPayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_create_restaurant(token, payload.model_dump())


@router.put("/restaurants/{restaurant_id}")
async def dashboard_restaurant_update(
    restaurant_id: UUID,
    payload: RestaurantUpsertPayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_update_restaurant(token, str(restaurant_id), payload.model_dump())


@router.put("/profile")
async def dashboard_profile_update(
    payload: ProfileUpdatePayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    return await dashboard_update_profile(token, payload.model_dump(exclude_none=True))
