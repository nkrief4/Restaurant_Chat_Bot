"""Application routers for server-rendered pages."""

from fastapi import APIRouter

from app.routes.dashboard_achats_stock import router as dashboard_achats_stock_router

router = APIRouter()
router.include_router(dashboard_achats_stock_router)

__all__ = ["router"]
