from typing import Any, Dict, List, Optional, Annotated
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from app.schemas import RestaurantUpsertPayload, ProfileUpdatePayload
from app.services import dashboard_service as dashboard_module
from app.services import menu_stats_service, recommendations_service, restaurant_service
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


@router.get("/summary")
async def dashboard_summary_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Any:
    token = extract_bearer_token(authorization)
    claims = dashboard_module._decode_claims(token)
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Utilisateur Supabase invalide.")

    restaurant = restaurant_service.get_default_restaurant_for_user(str(user_id))
    restaurant_id = restaurant.get("id") if restaurant else None
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Aucun restaurant associé à cet utilisateur.")

    return await dashboard_module.get_dashboard_summary(str(restaurant_id))


@router.get("/menu-performance")
async def dashboard_menu_performance_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Any:
    token = extract_bearer_token(authorization)
    return await dashboard_module.get_menu_performance(token)


@router.get("/sales-overview")
async def dashboard_sales_overview_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    restaurant_id: Optional[str] = Query(default=None, alias="restaurant_id"),
) -> Any:
    token = extract_bearer_token(authorization)
    return await menu_stats_service.get_sales_time_series(token, restaurant_id)


@router.get("/weekly-report")
async def dashboard_weekly_report_endpoint(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    restaurant_id: Optional[str] = Query(default=None, alias="restaurant_id"),
) -> Any:
    token = extract_bearer_token(authorization)
    return await recommendations_service.generate_business_report(token, restaurant_id)


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
