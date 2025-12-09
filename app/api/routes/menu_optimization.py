"""Menu optimization API for smart ordering based on ingredient stock levels."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, HTTPException
from httpx import HTTPError as HttpxError
from pydantic import BaseModel
from postgrest import APIError as PostgrestAPIError

from app.config.supabase_client import SUPABASE_SERVICE_ROLE_KEY
from app.services.postgrest_client import (
    create_postgrest_client,
    raise_postgrest_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/menu", tags=["Menu Optimization"])


class OptimizedMenuItem(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    menu_price: float
    category: str | None = None
    availability_score: float  # 0-100, higher = more available
    is_available: bool
    display_order: int


class OptimizedMenuResponse(BaseModel):
    categories: List[Dict[str, Any]]  # Ordered categories with optimized items


@router.get("/optimized/{restaurant_id}", response_model=OptimizedMenuResponse)
async def get_optimized_menu(restaurant_id: UUID) -> OptimizedMenuResponse:
    """
    Get menu with items optimally ordered based on ingredient stock levels.
    Items with ingredients in high stock appear first in their category.
    """
    
    def _request() -> Dict[str, Any]:
        with create_postgrest_client(
            SUPABASE_SERVICE_ROLE_KEY,
            api_key=SUPABASE_SERVICE_ROLE_KEY,
        ) as client:
            # Fetch menu items with their recipes
            menu_items_response = (
                client.table("menu_items")
                .select("id,name,description,menu_price,category,is_available,display_order")
                .eq("restaurant_id", str(restaurant_id))
                .eq("is_active", True)
                .execute()
            )
            
            # Fetch recipes (ingredients per dish)
            recipes_response = (
                client.table("recipes")
                .select("menu_item_id,ingredient_id,quantity_per_unit")
                .eq("restaurant_id", str(restaurant_id))
                .execute()
            )
            
            # Fetch ingredient stock levels
            stock_response = (
                client.table("ingredient_stock")
                .select("ingredient_id,current_stock,safety_stock")
                .eq("restaurant_id", str(restaurant_id))
                .execute()
            )
            
            return {
                "menu_items": menu_items_response.data or [],
                "recipes": recipes_response.data or [],
                "stock": stock_response.data or [],
            }

    try:
        data = await asyncio.to_thread(_request)
        
        # Build stock lookup
        stock_lookup = {
            item["ingredient_id"]: {
                "current": float(item.get("current_stock", 0)),
                "safety": float(item.get("safety_stock", 1)),
            }
            for item in data["stock"]
        }
        
        # Build recipe lookup (ingredients per menu item)
        recipe_lookup: Dict[str, List[Dict[str, Any]]] = {}
        for recipe in data["recipes"]:
            menu_item_id = recipe["menu_item_id"]
            if menu_item_id not in recipe_lookup:
                recipe_lookup[menu_item_id] = []
            recipe_lookup[menu_item_id].append({
                "ingredient_id": recipe["ingredient_id"],
                "quantity": float(recipe.get("quantity_per_unit", 0)),
            })
        
        # Calculate availability score for each menu item
        scored_items = []
        for item in data["menu_items"]:
            item_id = item["id"]
            ingredients = recipe_lookup.get(item_id, [])
            
            if not ingredients:
                # No ingredients = always available, neutral score
                availability_score = 50.0
            else:
                # Calculate score based on ingredient stock levels
                scores = []
                for ing in ingredients:
                    ing_id = ing["ingredient_id"]
                    stock_info = stock_lookup.get(ing_id)
                    
                    if not stock_info:
                        # No stock info = assume low availability
                        scores.append(25.0)
                        continue
                    
                    current = stock_info["current"]
                    safety = stock_info["safety"]
                    
                    if safety <= 0:
                        safety = 1  # Avoid division by zero
                    
                    # Score calculation:
                    # - Stock > 2x safety = 100 (excellent, overstock)
                    # - Stock = safety = 50 (normal)
                    # - Stock < safety = 0-50 (low stock)
                    ratio = current / safety
                    if ratio >= 2.0:
                        score = 100.0
                    elif ratio >= 1.0:
                        score = 50.0 + (ratio - 1.0) * 50.0  # 50-100
                    else:
                        score = ratio * 50.0  # 0-50
                    
                    scores.append(min(100.0, score))
                
                # Average score of all ingredients
                availability_score = sum(scores) / len(scores) if scores else 50.0
            
            scored_items.append({
                "id": item["id"],
                "name": item["name"],
                "description": item.get("description"),
                "menu_price": float(item["menu_price"]) if item.get("menu_price") is not None else 0.0,
                "category": item.get("category", "Autre"),
                "is_available": item.get("is_available", True),
                "display_order": item.get("display_order", 0),
                "availability_score": round(availability_score, 2),
            })

        
        # Group by category
        categories_dict: Dict[str, List[Dict[str, Any]]] = {}
        for item in scored_items:
            cat = item["category"] or "Autre"
            if cat not in categories_dict:
                categories_dict[cat] = []
            categories_dict[cat].append(item)
        
        # Sort items within each category by availability score (descending)
        for cat in categories_dict:
            categories_dict[cat].sort(
                key=lambda x: (-x["availability_score"], x["display_order"])
            )
        
        # Define category order
        category_order = {
            "Entrées": 1,
            "Entrée": 1,
            "Plats": 2,
            "Plat": 2,
            "Desserts": 3,
            "Dessert": 3,
            "Boissons": 4,
            "Boisson": 4,
        }
        
        # Sort categories
        sorted_categories = []
        for cat_name, items in categories_dict.items():
            order = category_order.get(cat_name, 99)
            sorted_categories.append({
                "name": cat_name,
                "order": order,
                "items": items,
            })
        
        sorted_categories.sort(key=lambda x: (x["order"], x["name"]))
        
        return OptimizedMenuResponse(categories=sorted_categories)
        
    except PostgrestAPIError as exc:
        raise_postgrest_error(exc, context="fetch optimized menu")
    except HttpxError as exc:
        raise HTTPException(
            status_code=503, detail="Supabase est temporairement inaccessible."
        ) from exc


__all__ = ["router"]
