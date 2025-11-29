"""Purchasing endpoints built on top of the purchasing service."""

from __future__ import annotations

import asyncio
import json
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from httpx import HTTPError as HttpxError
from pydantic import BaseModel, Field
from postgrest import APIError as PostgrestAPIError

from app.config.supabase_client import SUPABASE_SERVICE_ROLE_KEY
from app.services.postgrest_client import (
    create_postgrest_client,
    extract_bearer_token,
    raise_postgrest_error,
)
from app.services.purchasing import IngredientRecommendation, compute_purchase_recommendations

router = APIRouter(prefix="/api/purchasing", tags=["purchasing"])


async def get_current_restaurant_id(
    x_restaurant_id: Optional[str] = Header(default=None, alias="X-Restaurant-Id"),
) -> UUID:
    """Resolve the restaurant identifier from the current request."""

    if not x_restaurant_id:
        raise HTTPException(status_code=401, detail="Restaurant non authentifié.")
    try:
        return UUID(x_restaurant_id)
    except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail="Identifiant restaurant invalide.") from exc


async def get_access_token(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> str:
    """Extract the Supabase bearer token from the Authorization header."""

    return extract_bearer_token(authorization)


class SupplierSummary(BaseModel):
    id: UUID
    name: Optional[str] = None
    contact_email: Optional[str] = None


class PurchaseOrderLineBase(BaseModel):
    ingredient_id: UUID
    quantity_ordered: float = Field(..., gt=0)
    unit: str


class PurchaseOrderCreate(BaseModel):
    supplier_id: UUID
    expected_delivery_date: Optional[date] = None
    reorder_cycle_days: int = Field(default=7, ge=0)
    notes: Optional[str] = Field(default=None, max_length=800)
    lines: List[PurchaseOrderLineBase]


class PurchaseOrderLineResponse(PurchaseOrderLineBase):
    id: UUID
    ingredient_name: Optional[str] = None


class PurchaseOrderRecord(BaseModel):
    id: UUID
    restaurant_id: UUID
    supplier_id: UUID
    status: str
    created_at: datetime
    expected_delivery_date: Optional[date] = None
    lines: List[PurchaseOrderLineResponse] = Field(default_factory=list)


class PurchaseOrderDetailResponse(PurchaseOrderRecord):
    supplier: Optional[SupplierSummary] = None
    email_body: str


class TopIngredientSummary(BaseModel):
    ingredient_id: UUID
    ingredient_name: str
    status: str
    recommended_order_quantity: float


class TopMenuItemSummary(BaseModel):
    menu_item_id: Optional[UUID] = None
    menu_item_name: str
    quantity_sold: float


class PurchasingSummaryResponse(BaseModel):
    date_from: date
    date_to: date
    total_dishes_sold: float
    count_low: int
    count_critical: int
    count_no_data: int
    count_ok: int
    top_ingredients: List[TopIngredientSummary]
    top_menu_items: List[TopMenuItemSummary]


class IngredientCatalogItem(BaseModel):
    id: UUID
    name: str
    unit: str
    default_supplier_id: Optional[UUID] = None


class MenuItemSummary(BaseModel):
    id: UUID
    name: str


class RecipeIngredientRow(BaseModel):
    ingredient_id: UUID
    ingredient_name: str
    unit: str
    quantity_per_unit: float


class IngredientCreatePayload(BaseModel):
    name: str
    unit: str
    default_supplier_id: Optional[UUID] = None
    current_stock: float = Field(default=0, ge=0)
    safety_stock: float = Field(default=0, ge=0)


class RecipeUpsertPayload(BaseModel):
    menu_item_id: UUID
    ingredient_id: UUID
    quantity_per_unit: float = Field(..., gt=0)


class ManualSalePayload(BaseModel):
    menu_item_id: UUID
    quantity: int = Field(..., gt=0)
    ordered_at: Optional[datetime] = None


class RecipeIngredientWithCost(BaseModel):
    ingredient_id: UUID
    ingredient_name: str
    unit: str
    quantity_per_unit: float
    unit_cost: float = Field(default=0.0)
    total_cost: float = Field(default=0.0)


class RecipeWithCostResponse(BaseModel):
    menu_item_id: UUID
    menu_item_name: str
    category: Optional[str] = None
    total_cost: float = Field(default=0.0)
    menu_price: Optional[float] = None
    profit_margin: Optional[float] = None
    ingredients: List[RecipeIngredientWithCost] = Field(default_factory=list)
    instructions: Optional[str] = None


class MenuItemCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    menu_price: Optional[float] = Field(default=None, ge=0)
    production_cost: Optional[float] = Field(default=None, ge=0)
    instructions: Optional[str] = Field(default=None, max_length=2000)


class MenuItemUpdatePayload(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    menu_price: Optional[float] = Field(default=None, ge=0)
    production_cost: Optional[float] = Field(default=None, ge=0)
    instructions: Optional[str] = Field(default=None, max_length=2000)



class SupabasePurchasingDAO:
    """DAO relying on Supabase/PostgREST for multi-tenant purchasing data."""

    def __init__(
        self,
        restaurant_id: UUID,
        access_token: str,
        *,
        api_key: Optional[str] = None,
    ):
        self.restaurant_id = restaurant_id
        self.restaurant_id_str = str(restaurant_id)
        self.access_token = access_token
        self.api_key = api_key
        self._menu_items_supports_display_name: Optional[bool] = None

    def _client(self, *, prefer: Optional[str] = None):
        return create_postgrest_client(self.access_token, prefer=prefer, api_key=self.api_key)

    @staticmethod
    def _menu_items_select_clause(include_display_name: bool) -> str:
        return "id,name,display_name" if include_display_name else "id,name"

    @staticmethod
    def _is_missing_display_name_error(exc: PostgrestAPIError) -> bool:
        if str(getattr(exc, "code", "")) != "42703":
            return False
        message_parts = [exc.message or "", getattr(exc, "details", "") or "", getattr(exc, "hint", "") or ""]
        combined = " ".join(part for part in message_parts if part).lower()
        return "display_name" in combined

    async def fetch_all_ingredients(self) -> List[Dict[str, Any]]:
        """Return the catalog of ingredients for the restaurant."""

        def _request() -> List[Dict[str, Any]]:
            with self._client() as client:
                response = (
                    client.table("ingredients")
                    .select("id,restaurant_id,name,unit,default_supplier_id")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .order("name")
                    .execute()
                )
                rows = response.data or []
                normalized = []
                for row in rows:
                    normalized.append(
                        {
                            "id": row.get("id"),
                            "restaurant_id": row.get("restaurant_id"),
                            "name": row.get("name"),
                            "unit": row.get("unit"),
                            "default_supplier_id": row.get("default_supplier_id"),
                            "last_order_date": None,
                            "last_order_quantity": None,
                        }
                    )
                return normalized

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="fetch ingredients")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_stock_data(self) -> Dict[Any, Dict[str, Any]]:
        """Return the current stock levels keyed by ingredient ID."""

        def _request() -> Dict[str, Dict[str, Any]]:
            with self._client() as client:
                response = (
                    client.table("ingredient_stock")
                    .select("ingredient_id,current_stock,safety_stock,last_manual_update_at")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .execute()
                )
                rows = response.data or []
                stock: Dict[str, Dict[str, Any]] = {}
                for row in rows:
                    ingredient_id = row.get("ingredient_id")
                    if not ingredient_id:
                        continue
                    stock[str(ingredient_id)] = {
                        "current_stock": float(row.get("current_stock") or 0),
                        "safety_stock": float(row.get("safety_stock") or 0),
                        "last_manual_update_at": row.get("last_manual_update_at"),
                    }
                return stock

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="fetch stock")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_supplier_and_lead_time_data(self) -> Dict[str, Dict[Any, Dict[str, Any]]]:
        """Return both ingredient-specific overrides and supplier defaults."""

        def _request() -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
            with self._client() as client:
                overrides = (
                    client.table("ingredient_suppliers")
                    .select("ingredient_id,supplier_id,lead_time_days")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .execute()
                ).data or []
                suppliers = (
                    client.table("suppliers")
                    .select("id,name,contact_email,default_lead_time_days")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .order("name")
                    .execute()
                ).data or []
                return overrides, suppliers

        try:
            overrides, supplier_rows = await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="fetch suppliers")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

        supplier_map: Dict[str, Dict[str, Any]] = {}
        for row in supplier_rows:
            supplier_id = row.get("id")
            if not supplier_id:
                continue
            supplier_map[str(supplier_id)] = {
                "id": supplier_id,
                "name": row.get("name"),
                "contact_email": row.get("contact_email"),
                "default_lead_time_days": row.get("default_lead_time_days"),
            }

        ingredient_map: Dict[str, Dict[str, Any]] = {}
        for row in overrides:
            ingredient_id = row.get("ingredient_id")
            supplier_id = row.get("supplier_id")
            if not ingredient_id or not supplier_id:
                continue
            supplier_entry = supplier_map.get(str(supplier_id))
            ingredient_map[str(ingredient_id)] = {
                "supplier_id": supplier_id,
                "lead_time_days": row.get("lead_time_days"),
                "supplier_name": supplier_entry.get("name") if supplier_entry else None,
            }

        return {
            "ingredient_suppliers": ingredient_map,
            "suppliers": supplier_map,
        }

    async def fetch_suppliers(self) -> List[Dict[str, Any]]:
        def _request() -> List[Dict[str, Any]]:
            with self._client() as client:
                response = (
                    client.table("suppliers")
                    .select("id,name,contact_email")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .order("name")
                    .execute()
                )
                return response.data or []

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover
            raise_postgrest_error(exc, context="fetch suppliers list")
        except HttpxError as exc:  # pragma: no cover
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_historical_orders_and_recipes(self, date_from: date, date_to: date) -> Dict[str, Any]:
        """Return aggregated consumption data for the requested period."""

        def _request() -> Dict[str, List[Dict[str, Any]]]:
            with self._client() as client:
                orders_query = (
                    client.table("orders")
                    .select("id,menu_item_id,quantity,ordered_at")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .gte("ordered_at", self._format_boundary(date_from, start_of_day=True))
                    .lte("ordered_at", self._format_boundary(date_to, start_of_day=False))
                )
                orders = orders_query.execute().data or []

                menu_item_ids = sorted({row.get("menu_item_id") for row in orders if row.get("menu_item_id")})
                recipes: List[Dict[str, Any]] = []
                if menu_item_ids:
                    recipes = (
                        client.table("recipes")
                        .select("menu_item_id,ingredient_id,quantity_per_unit")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("menu_item_id", menu_item_ids)
                        .execute()
                    ).data or []
                return {"orders": orders, "recipes": recipes, "menu_item_ids": menu_item_ids}

        try:
            dataset = await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="fetch orders")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

        orders = dataset.get("orders") or []
        if not orders:
            return {"consumption": {}, "total_dishes": 0, "top_menu_items": []}

        recipe_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for recipe in dataset.get("recipes") or []:
            menu_item_id = recipe.get("menu_item_id")
            if menu_item_id:
                recipe_map[str(menu_item_id)].append(recipe)

        menu_items_rows: List[Dict[str, Any]] = []
        menu_item_ids = dataset.get("menu_item_ids") or []
        if menu_item_ids:
            menu_items_rows = await self._fetch_menu_items_rows(
                menu_item_ids=menu_item_ids,
                context="fetch menu items",
            )

        menu_item_names: Dict[str, str] = {}
        for item in menu_items_rows:
            identifier = item.get("id")
            if identifier:
                menu_item_names[str(identifier)] = item.get("display_name") or item.get("name") or "Plat"

        consumption: Dict[str, float] = defaultdict(float)
        menu_totals: Dict[str, float] = defaultdict(float)
        total_dishes = 0.0

        for order in orders:
            menu_item_id = order.get("menu_item_id")
            quantity = float(order.get("quantity") or 0)
            if not menu_item_id or quantity <= 0:
                continue
            key = str(menu_item_id)
            menu_totals[key] += quantity
            total_dishes += quantity
            for recipe in recipe_map.get(key, []):
                ingredient_id = recipe.get("ingredient_id")
                qty_per_unit = float(recipe.get("quantity_per_unit") or 0)
                if not ingredient_id or qty_per_unit <= 0:
                    continue
                consumption[str(ingredient_id)] += quantity * qty_per_unit

        top_menu_items = [
            {
                "menu_item_id": menu_id,
                "menu_item_name": menu_item_names.get(menu_id, "Plat"),
                "quantity": qty,
            }
            for menu_id, qty in sorted(menu_totals.items(), key=lambda entry: entry[1], reverse=True)
        ][:5]

        return {
            "consumption": dict(consumption),
            "total_dishes": total_dishes,
            "top_menu_items": top_menu_items,
        }

    async def create_purchase_order_and_lines(self, payload: PurchaseOrderCreate) -> Dict[str, Any]:
        """Persist a purchase order and its lines, returning the created record."""

        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                order_response = (
                    client.table("purchase_orders")
                    .insert(
                        {
                            "restaurant_id": self.restaurant_id_str,
                            "supplier_id": str(payload.supplier_id),
                            "expected_delivery_date": payload.expected_delivery_date.isoformat()
                            if payload.expected_delivery_date
                            else None,
                        }
                    )
                    .execute()
                )
                if not order_response.data:
                    raise HTTPException(status_code=502, detail="Création de commande impossible.")
                order_record = order_response.data[0]
                order_id = order_record.get("id")
                line_payload = [
                    {
                        "restaurant_id": self.restaurant_id_str,
                        "purchase_order_id": order_id,
                        "ingredient_id": str(line.ingredient_id),
                        "quantity_ordered": float(line.quantity_ordered),
                        "unit": line.unit,
                    }
                    for line in payload.lines
                ]
                if not line_payload:
                    raise HTTPException(status_code=400, detail="Ajoutez au moins un ingrédient à la commande.")
                if line_payload:
                    lines_response = (
                        client.table("purchase_order_lines")
                        .insert(line_payload)
                        .execute()
                    )
                    lines = lines_response.data or []
                else:
                    lines = []
                order_record["lines"] = lines
                return order_record

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="create purchase order")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_purchase_order_details(self, order_id: UUID) -> Optional[Dict[str, Any]]:
        """Retrieve a purchase order with supplier metadata."""

        def _request() -> Optional[Dict[str, Any]]:
            with self._client() as client:
                order_response = (
                    client.table("purchase_orders")
                    .select("id,restaurant_id,supplier_id,status,created_at,expected_delivery_date")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(order_id))
                    .limit(1)
                    .execute()
                )
                if not order_response.data:
                    return None
                order_record = order_response.data[0]

                supplier = None
                supplier_id = order_record.get("supplier_id")
                if supplier_id:
                    supplier_response = (
                        client.table("suppliers")
                        .select("id,name,contact_email")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .eq("id", supplier_id)
                        .limit(1)
                        .execute()
                    )
                    if supplier_response.data:
                        supplier = supplier_response.data[0]

                lines_response = (
                    client.table("purchase_order_lines")
                    .select("id,ingredient_id,quantity_ordered,unit")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("purchase_order_id", str(order_id))
                    .execute()
                )
                lines = lines_response.data or []
                ingredient_ids = {line.get("ingredient_id") for line in lines if line.get("ingredient_id")}
                ingredient_names: Dict[str, str] = {}
                if ingredient_ids:
                    ingredient_response = (
                        client.table("ingredients")
                        .select("id,name")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("id", list(ingredient_ids))
                        .execute()
                    )
                    for row in ingredient_response.data or []:
                        if row.get("id"):
                            ingredient_names[str(row["id"])] = row.get("name") or "Ingrédient"

                for line in lines:
                    ingredient_id = line.get("ingredient_id")
                    line["ingredient_name"] = ingredient_names.get(str(ingredient_id))

                order_record["supplier"] = supplier
                order_record["lines"] = lines
                return order_record

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - network interaction
            raise_postgrest_error(exc, context="fetch purchase order")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_purchase_orders(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Retrieve the most recent purchase orders."""

        def _request() -> List[Dict[str, Any]]:
            with self._client() as client:
                response = (
                    client.table("purchase_orders")
                    .select("id,restaurant_id,supplier_id,status,created_at,expected_delivery_date, purchase_order_lines(count)")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
                orders = response.data or []
                
                # Fetch supplier names
                supplier_ids = {o.get("supplier_id") for o in orders if o.get("supplier_id")}
                supplier_map = {}
                if supplier_ids:
                    suppliers_response = (
                        client.table("suppliers")
                        .select("id,name")
                        .in_("id", list(supplier_ids))
                        .execute()
                    )
                    for s in suppliers_response.data or []:
                        supplier_map[s.get("id")] = s.get("name")

                # Enrich orders
                enriched_orders = []
                for order in orders:
                    # Extract line count from the nested response if available, or default to 0
                    # PostgREST returns count as a list of dicts or similar depending on query
                    # Here we requested purchase_order_lines(count), so it might be in a specific format.
                    # Actually, let's simplify and just get the raw data and process it.
                    # A safer way for count is usually separate or careful selection. 
                    # Let's try to map supplier name first.
                    supplier_name = supplier_map.get(order.get("supplier_id"))
                    
                    # For line count, the select "purchase_order_lines(count)" usually returns a list like [{'count': N}]
                    # Let's handle that safely.
                    lines_data = order.get("purchase_order_lines")
                    line_count = 0
                    if isinstance(lines_data, list) and len(lines_data) > 0:
                         line_count = lines_data[0].get("count", 0)
                    elif isinstance(lines_data, int): # sometimes it might be just int if configured differently
                         line_count = lines_data

                    enriched_orders.append({
                        "id": order.get("id"),
                        "supplier_name": supplier_name or "Fournisseur inconnu",
                        "status": order.get("status"),
                        "created_at": order.get("created_at"),
                        "expected_delivery_date": order.get("expected_delivery_date"),
                        "line_count": line_count
                    })
                return enriched_orders

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="fetch purchase orders")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def update_ingredient_safety_stock(self, ingredient_id: UUID, safety_stock: float) -> Dict[str, Any]:
        """Update the safety stock for a specific ingredient."""
        
        def _request() -> Dict[str, Any]:
            with self._client() as client:
                # Check if stock record exists
                response = (
                    client.table("ingredient_stock")
                    .select("id")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("ingredient_id", str(ingredient_id))
                    .execute()
                )
                data = response.data or []
                
                if data:
                    # Update existing
                    update_response = (
                        client.table("ingredient_stock")
                        .update({"safety_stock": safety_stock, "updated_at": datetime.now(timezone.utc).isoformat()})
                        .eq("restaurant_id", self.restaurant_id_str)
                        .eq("ingredient_id", str(ingredient_id))
                        .execute()
                    )
                    return update_response.data[0] if update_response.data else {}
                else:
                    # Create new stock record
                    insert_response = (
                        client.table("ingredient_stock")
                        .insert({
                            "restaurant_id": self.restaurant_id_str,
                            "ingredient_id": str(ingredient_id),
                            "safety_stock": safety_stock,
                            "current_stock": 0  # Default to 0 if creating new
                        })
                        .execute()
                    )
                    return insert_response.data[0] if insert_response.data else {}

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="update safety stock")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def delete_ingredient(self, ingredient_id: UUID) -> None:
        """Delete an ingredient."""
        
        def _request():
            with self._client() as client:
                # First delete related stock records (if not cascading)
                client.table("ingredient_stock").delete().eq("restaurant_id", self.restaurant_id_str).eq("ingredient_id", str(ingredient_id)).execute()
                
                # Then delete the ingredient
                client.table("ingredients").delete().eq("restaurant_id", self.restaurant_id_str).eq("id", str(ingredient_id)).execute()

        try:
            await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="delete ingredient")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_menu_items(self) -> List[Dict[str, Any]]:
        rows = await self._fetch_menu_items_rows(context="fetch menu items")
        if rows:
            return rows
        seeded = await self._seed_menu_items_from_menu_document()
        if seeded:
            return await self._fetch_menu_items_rows(context="fetch menu items")
        return []

    async def fetch_recipes_for_menu_item(self, menu_item_id: UUID) -> List[Dict[str, Any]]:
        def _request() -> List[Dict[str, Any]]:
            with self._client() as client:
                recipe_response = (
                    client.table("recipes")
                    .select("ingredient_id,quantity_per_unit")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("menu_item_id", str(menu_item_id))
                    .execute()
                )
                recipes = recipe_response.data or []
                ingredient_ids = {
                    str(row.get("ingredient_id"))
                    for row in recipes
                    if row.get("ingredient_id")
                }
                ingredient_lookup: Dict[str, Dict[str, Any]] = {}
                if ingredient_ids:
                    ingredient_response = (
                        client.table("ingredients")
                        .select("id,name,unit")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("id", list(ingredient_ids))
                        .execute()
                    )
                    for row in ingredient_response.data or []:
                        identifier = row.get("id")
                        if identifier:
                            ingredient_lookup[str(identifier)] = row

                enriched: List[Dict[str, Any]] = []
                for recipe in recipes:
                    ingredient_id = recipe.get("ingredient_id")
                    if not ingredient_id:
                        continue
                    lookup = ingredient_lookup.get(str(ingredient_id), {})
                    enriched.append(
                        {
                            "ingredient_id": ingredient_id,
                            "ingredient_name": lookup.get("name") or "Ingrédient",
                            "unit": lookup.get("unit") or "",
                            "quantity_per_unit": float(recipe.get("quantity_per_unit") or 0),
                        }
                    )
                return enriched

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="fetch menu recipe")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def create_ingredient(self, payload: IngredientCreatePayload) -> Dict[str, Any]:
        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                response = (
                    client.table("ingredients")
                    .insert(
                        {
                            "restaurant_id": self.restaurant_id_str,
                            "name": payload.name,
                            "unit": payload.unit,
                            "default_supplier_id": str(payload.default_supplier_id)
                            if payload.default_supplier_id
                            else None,
                        }
                    )
                    .execute()
                )
                if not response.data:
                    raise HTTPException(status_code=502, detail="Impossible de créer l'ingrédient.")
                
                ingredient = response.data[0]
                ingredient_id = ingredient.get("id")
                
                # Create stock record
                client.table("ingredient_stock").insert({
                    "restaurant_id": self.restaurant_id_str,
                    "ingredient_id": ingredient_id,
                    "current_stock": payload.current_stock,
                    "safety_stock": payload.safety_stock,
                    "last_manual_update_at": datetime.now(timezone.utc).isoformat()
                }).execute()
                
                return ingredient

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="create ingredient")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def update_ingredient(self, ingredient_id: UUID, payload: IngredientCreatePayload) -> Dict[str, Any]:
        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                response = (
                    client.table("ingredients")
                    .update(
                        {
                            "name": payload.name,
                            "unit": payload.unit,
                            "default_supplier_id": str(payload.default_supplier_id)
                            if payload.default_supplier_id
                            else None,
                        }
                    )
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(ingredient_id))
                    .execute()
                )
                if not response.data:
                    raise HTTPException(status_code=404, detail="Ingrédient introuvable.")
                return response.data[0]

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="update ingredient")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def delete_ingredient(self, ingredient_id: UUID) -> None:
        def _request() -> None:
            with self._client(prefer="return=representation") as client:
                response = (
                    client.table("ingredients")
                    .delete()
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(ingredient_id))
                    .execute()
                )
                if not response.data:
                    raise HTTPException(status_code=404, detail="Ingrédient introuvable.")

        try:
            await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="delete ingredient")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def upsert_recipe(self, payload: RecipeUpsertPayload) -> None:
        def _request() -> None:
            with self._client() as client:
                (
                    client.table("recipes")
                    .upsert(
                        {
                            "id": str(uuid4()),
                            "restaurant_id": self.restaurant_id_str,
                            "menu_item_id": str(payload.menu_item_id),
                            "ingredient_id": str(payload.ingredient_id),
                            "quantity_per_unit": float(payload.quantity_per_unit),
                        },
                        on_conflict="restaurant_id,menu_item_id,ingredient_id",
                    )
                    .execute()
                )

        try:
            await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="upsert recipe")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def record_manual_sale(self, payload: ManualSalePayload) -> Dict[str, Any]:
        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                body = {
                    "restaurant_id": self.restaurant_id_str,
                    "menu_item_id": str(payload.menu_item_id),
                    "quantity": int(payload.quantity),
                    "source": "manual_dashboard",
                }
                if payload.ordered_at:
                    body["ordered_at"] = payload.ordered_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                response = client.table("orders").insert(body).execute()
                if not response.data:
                    raise HTTPException(status_code=502, detail="Impossible d'enregistrer la vente.")
                return response.data[0]

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="record sale")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_all_recipes_with_costs(self) -> List[Dict[str, Any]]:
        """Fetch all recipes with calculated costs and profit margins."""
        
        def _request() -> List[Dict[str, Any]]:
            with self._client() as client:
                # Fetch all menu items for the restaurant
                menu_items_response = (
                    client.table("menu_items")
                    .select("id,name,category,menu_price,production_cost,instructions")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .order("name")
                    .execute()
                )
                menu_items = menu_items_response.data or []
                
                if not menu_items:
                    return []
                
                menu_item_ids = [item["id"] for item in menu_items]
                
                # Fetch all recipes for these menu items
                recipes_response = (
                    client.table("recipes")
                    .select("menu_item_id,ingredient_id,quantity_per_unit")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .in_("menu_item_id", menu_item_ids)
                    .execute()
                )
                recipes = recipes_response.data or []
                
                # Fetch ingredient costs from ingredient_stock
                ingredient_ids = list(set(r["ingredient_id"] for r in recipes if r.get("ingredient_id")))
                ingredient_costs = {}
                ingredient_names = {}
                
                if ingredient_ids:
                    # Get ingredient info
                    ingredients_response = (
                        client.table("ingredients")
                        .select("id,name")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("id", ingredient_ids)
                        .execute()
                    )
                    for ing in ingredients_response.data or []:
                        ingredient_names[ing["id"]] = ing.get("name", "Unknown")
                    
                # Fetch ingredient costs
                ingredient_costs = {}
                if ingredient_ids: # Ensure ingredient_ids is not empty before querying
                    stock_response = (
                        client.table("ingredient_stock")
                        .select("ingredient_id,unit_cost")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("ingredient_id", ingredient_ids)
                        .execute()
                    )
                    for stock in stock_response.data or []:
                        ingredient_costs[stock["ingredient_id"]] = float(stock.get("unit_cost", 0))
                
                # Group recipes by menu_item_id and calculate costs
                recipes_by_menu_item = {}
                for recipe in recipes:
                    menu_item_id = recipe["menu_item_id"]
                    if menu_item_id not in recipes_by_menu_item:
                        recipes_by_menu_item[menu_item_id] = []
                    recipes_by_menu_item[menu_item_id].append(recipe)
                
                # Build results with costs
                results = []
                for item in menu_items:
                    item_id = item["id"]
                    item_recipes = recipes_by_menu_item.get(item_id, [])
                    
                    # Calculate total cost
                    calculated_cost = 0.0
                    for recipe in item_recipes:
                        ingredient_id = recipe.get("ingredient_id")
                        quantity = float(recipe.get("quantity_per_unit", 0))
                        unit_cost = ingredient_costs.get(ingredient_id, 0.0)
                        calculated_cost += quantity * unit_cost
                    
                    # Use production_cost if set, otherwise calculated_cost
                    production_cost = item.get("production_cost")
                    final_cost = float(production_cost) if production_cost is not None else calculated_cost
                    
                    # Calculate profit margin if menu price exists
                    menu_price = item.get("menu_price")
                    profit_margin = None
                    if menu_price and menu_price > 0 and final_cost > 0:
                        profit_margin = ((menu_price - final_cost) / menu_price) * 100
                    
                    results.append({
                        "menu_item_id": item_id,
                        "menu_item_name": item.get("name", ""),
                        "category": item.get("category"),
                        "total_cost": round(final_cost, 2),
                        "menu_price": menu_price,
                        "profit_margin": round(profit_margin, 1) if profit_margin is not None else None,
                        "ingredient_count": len(item_recipes),
                        "is_manual_cost": production_cost is not None
                    })
                
                return results
        
        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="fetch recipes with costs")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def fetch_recipe_details(self, menu_item_id: UUID) -> Optional[Dict[str, Any]]:
        """Fetch detailed recipe information including ingredients with costs."""
        
        def _request() -> Optional[Dict[str, Any]]:
            with self._client() as client:
                # Fetch menu item
                menu_item_response = (
                    client.table("menu_items")
                    .select("id,name,category,menu_price,production_cost,instructions")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(menu_item_id))
                    .limit(1)
                    .execute()
                )
                
                if not menu_item_response.data:
                    return None
                
                menu_item = menu_item_response.data[0]
                
                # Fetch recipes (ingredients)
                recipes_response = (
                    client.table("recipes")
                    .select("ingredient_id,quantity_per_unit")
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("menu_item_id", str(menu_item_id))
                    .execute()
                )
                recipes = recipes_response.data or []
                
                # Fetch ingredient details and costs
                ingredient_ids = [r["ingredient_id"] for r in recipes if r.get("ingredient_id")]
                ingredients_data = {}
                
                if ingredient_ids:
                    # Get ingredient info
                    ingredients_response = (
                        client.table("ingredients")
                        .select("id,name,unit")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("id", ingredient_ids)
                        .execute()
                    )
                    for ing in ingredients_response.data or []:
                        ingredients_data[ing["id"]] = {
                            "name": ing.get("name", "Unknown"),
                            "unit": ing.get("unit", ""),
                            "unit_cost": 0.0
                        }
                    
                    # Get costs from stock
                    stock_response = (
                        client.table("ingredient_stock")
                        .select("ingredient_id,unit_cost")
                        .eq("restaurant_id", self.restaurant_id_str)
                        .in_("ingredient_id", ingredient_ids)
                        .execute()
                    )
                    for stock in stock_response.data or []:
                        ing_id = stock["ingredient_id"]
                        if ing_id in ingredients_data:
                            ingredients_data[ing_id]["unit_cost"] = float(stock.get("unit_cost", 0))
                
                # Build ingredient list with costs
                ingredients_list = []
                total_cost = 0.0
                
                for recipe in recipes:
                    ing_id = recipe.get("ingredient_id")
                    quantity = float(recipe.get("quantity_per_unit", 0))
                    
                    if ing_id and ing_id in ingredients_data:
                        ing_data = ingredients_data[ing_id]
                        unit_cost = ing_data["unit_cost"]
                        item_total = quantity * unit_cost
                        total_cost += item_total
                        
                        ingredients_list.append({
                            "ingredient_id": ing_id,
                            "ingredient_name": ing_data["name"],
                            "unit": ing_data["unit"],
                            "quantity_per_unit": quantity,
                            "unit_cost": unit_cost,
                            "total_cost": round(item_total, 2)
                        })
                
                # Calculate profit margin
                production_cost = menu_item.get("production_cost")
                final_cost = float(production_cost) if production_cost is not None else total_cost

                menu_price = menu_item.get("menu_price")
                profit_margin = None
                if menu_price and menu_price > 0 and final_cost > 0:
                    profit_margin = ((menu_price - final_cost) / menu_price) * 100
                
                return {
                    "menu_item_id": menu_item["id"],
                    "menu_item_name": menu_item.get("name", ""),
                    "category": menu_item.get("category"),
                    "total_cost": round(final_cost, 2),
                    "menu_price": menu_price,
                    "profit_margin": round(profit_margin, 1) if profit_margin is not None else None,
                    "ingredients": ingredients_list,
                    "instructions": menu_item.get("instructions"),
                    "production_cost": production_cost
                }
        
        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="fetch recipe details")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def create_menu_item(self, payload: MenuItemCreatePayload) -> Dict[str, Any]:
        """Create a new menu item."""
        
        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                data = {
                    "restaurant_id": self.restaurant_id_str,
                    "name": payload.name,
                }
                if payload.category:
                    data["category"] = payload.category
                if payload.menu_price is not None:
                    data["menu_price"] = payload.menu_price
                if payload.instructions:
                    data["instructions"] = payload.instructions
                
                response = (
                    client.table("menu_items")
                    .insert(data)
                    .execute()
                )
                
                if not response.data:
                    raise HTTPException(status_code=502, detail="Impossible de créer le plat.")
                
                return response.data[0]
        
        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="create menu item")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def update_menu_item(self, menu_item_id: UUID, payload: MenuItemUpdatePayload) -> Dict[str, Any]:
        """Update a menu item."""
        
        def _request() -> Dict[str, Any]:
            with self._client(prefer="return=representation") as client:
                data = {}
                if payload.name is not None:
                    data["name"] = payload.name
                if payload.category is not None:
                    data["category"] = payload.category
                if payload.menu_price is not None:
                    data["menu_price"] = payload.menu_price
                if payload.production_cost is not None:
                    data["production_cost"] = payload.production_cost
                if payload.instructions is not None:
                    data["instructions"] = payload.instructions
                
                if not data:
                    raise HTTPException(status_code=400, detail="Aucune donnée à mettre à jour.")
                
                response = (
                    client.table("menu_items")
                    .update(data)
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(menu_item_id))
                    .execute()
                )
                
                if not response.data:
                    raise HTTPException(status_code=404, detail="Plat introuvable.")
                
                return response.data[0]
        
        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="update menu item")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def delete_menu_item(self, menu_item_id: UUID) -> None:
        """Delete a menu item and its associated recipes."""
        
        def _request() -> None:
            with self._client() as client:
                # First delete associated recipes
                client.table("recipes").delete().eq("restaurant_id", self.restaurant_id_str).eq("menu_item_id", str(menu_item_id)).execute()
                
                # Then delete the menu item
                response = (
                    client.table("menu_items")
                    .delete()
                    .eq("restaurant_id", self.restaurant_id_str)
                    .eq("id", str(menu_item_id))
                    .execute()
                )
                
                if not response.data:
                    raise HTTPException(status_code=404, detail="Plat introuvable.")
        
        try:
            await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:
            raise_postgrest_error(exc, context="delete menu item")
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc


    async def _fetch_menu_items_rows(
        self,
        *,
        menu_item_ids: Optional[Sequence[Any]] = None,
        context: str,
    ) -> List[Dict[str, Any]]:
        def _fetch(include_display_name: bool) -> List[Dict[str, Any]]:
            fields = self._menu_items_select_clause(include_display_name)
            with self._client() as client:
                query = (
                    client.table("menu_items")
                    .select(fields)
                    .eq("restaurant_id", self.restaurant_id_str)
                )
                if menu_item_ids:
                    query = query.in_("id", list(menu_item_ids))
                order_column = "display_name" if include_display_name else "name"
                query = query.order(order_column)
                response = query.execute()
                return response.data or []

        return await self._execute_with_display_name_fallback(_fetch, context=context)

    async def _execute_with_display_name_fallback(
        self,
        fetcher: Callable[[bool], List[Dict[str, Any]]],
        *,
        context: str,
    ) -> List[Dict[str, Any]]:
        include_display_name = self._menu_items_supports_display_name is not False

        def _run(flag: bool) -> List[Dict[str, Any]]:
            return fetcher(flag)

        try:
            result = await asyncio.to_thread(_run, include_display_name)
            if include_display_name and self._menu_items_supports_display_name is None:
                self._menu_items_supports_display_name = True
            return result
        except PostgrestAPIError as exc:
            if include_display_name and self._is_missing_display_name_error(exc):
                self._menu_items_supports_display_name = False
                try:
                    return await asyncio.to_thread(_run, False)
                except PostgrestAPIError as retry_exc:
                    raise_postgrest_error(retry_exc, context=context)
                except HttpxError as retry_exc:
                    raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from retry_exc
            raise_postgrest_error(exc, context=context)
        except HttpxError as exc:
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    async def _seed_menu_items_from_menu_document(self) -> bool:
        def _request() -> bool:
            with self._client(prefer="return=representation") as client:
                restaurant_response = (
                    client.table("restaurants")
                    .select("menu_document")
                    .eq("id", self.restaurant_id_str)
                    .limit(1)
                    .execute()
                )
                if not restaurant_response.data:
                    return False
                document = _normalize_menu_document(restaurant_response.data[0].get("menu_document"))
                names = _extract_menu_item_names(document)
                if not names:
                    return False
                payload: List[Dict[str, Any]] = []
                for name in names:
                    entry: Dict[str, Any] = {
                        "restaurant_id": self.restaurant_id_str,
                        "name": name,
                    }
                    if self._menu_items_supports_display_name is not False:
                        entry["display_name"] = name
                    payload.append(entry)
                client.table("menu_items").insert(payload).execute()
                return True

        try:
            return await asyncio.to_thread(_request)
        except PostgrestAPIError as exc:  # pragma: no cover - depends on schema
            raise_postgrest_error(exc, context="bootstrap menu items")
        except HttpxError as exc:  # pragma: no cover - network interaction
            raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    @staticmethod
    def _format_boundary(value: date, *, start_of_day: bool) -> str:
        boundary = time.min if start_of_day else time.max
        timestamp = datetime.combine(value, boundary, tzinfo=timezone.utc)
        return timestamp.isoformat().replace("+00:00", "Z")


async def get_purchasing_dao(
    restaurant_id: UUID = Depends(get_current_restaurant_id),
    access_token: str = Depends(get_access_token),
) -> SupabasePurchasingDAO:
    await _ensure_restaurant_authorized(restaurant_id, access_token)
    db_token, api_key = _resolve_postgrest_credentials(access_token)
    return SupabasePurchasingDAO(restaurant_id, db_token, api_key=api_key)


async def _ensure_restaurant_authorized(restaurant_id: UUID, access_token: str) -> None:
    """Make sure the authenticated user can access the requested restaurant."""

    def _request() -> bool:
        with create_postgrest_client(access_token) as client:
            response = (
                client.table("restaurants")
                .select("id")
                .eq("id", str(restaurant_id))
                .limit(1)
                .execute()
            )
            return bool(response.data)

    try:
        is_authorized = await asyncio.to_thread(_request)
    except PostgrestAPIError as exc:  # pragma: no cover - network interaction
        raise_postgrest_error(exc, context="restaurant access check")
    except HttpxError as exc:  # pragma: no cover - network interaction
        raise HTTPException(status_code=503, detail="Supabase est temporairement inaccessible.") from exc

    if not is_authorized:
        raise HTTPException(status_code=403, detail="Accès refusé à ce restaurant.")


def _resolve_postgrest_credentials(access_token: str) -> tuple[str, Optional[str]]:
    """Return the token/api key pair to use with PostgREST."""

    if SUPABASE_SERVICE_ROLE_KEY:
        return SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY
    return access_token, None


@router.get("/ingredients", response_model=List[IngredientRecommendation])
async def list_purchase_recommendations(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    reorder_cycle_days: int = Query(default=7, ge=0),
    default_lead_time_days: int = Query(default=2, ge=0),
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> List[IngredientRecommendation]:
    """Return computed purchase recommendations for all ingredients."""

    resolved_start, resolved_end = _resolve_date_range(date_from, date_to)
    historical = await dao.fetch_historical_orders_and_recipes(resolved_start, resolved_end)
    consumption = dict(historical.get("consumption", {}))
    ingredients = await dao.fetch_all_ingredients()
    stock_data = await dao.fetch_stock_data()
    supplier_payload = await dao.fetch_supplier_and_lead_time_data()

    return _compute_recommendations(
        ingredients,
        consumption,
        stock_data,
        supplier_payload,
        resolved_start,
        resolved_end,
        reorder_cycle_days,
        default_lead_time_days,
    )


@router.get("/summary", response_model=PurchasingSummaryResponse)
async def purchasing_summary(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    reorder_cycle_days: int = Query(default=7, ge=0),
    default_lead_time_days: int = Query(default=2, ge=0),
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> PurchasingSummaryResponse:
    """Return aggregated KPIs for the purchasing dashboard."""

    resolved_start, resolved_end = _resolve_date_range(date_from, date_to)
    historical = await dao.fetch_historical_orders_and_recipes(resolved_start, resolved_end)
    consumption = dict(historical.get("consumption", {}))
    ingredients = await dao.fetch_all_ingredients()
    stock_data = await dao.fetch_stock_data()
    supplier_payload = await dao.fetch_supplier_and_lead_time_data()
    recommendations = _compute_recommendations(
        ingredients,
        consumption,
        stock_data,
        supplier_payload,
        resolved_start,
        resolved_end,
        reorder_cycle_days,
        default_lead_time_days,
    )

    status_counts = Counter(rec.status for rec in recommendations)
    top_ingredients = sorted(
        (
            TopIngredientSummary(
                ingredient_id=rec.ingredient_id,
                ingredient_name=rec.ingredient_name,
                status=rec.status,
                recommended_order_quantity=rec.recommended_order_quantity,
            )
            for rec in recommendations
        ),
        key=lambda entry: entry.recommended_order_quantity,
        reverse=True,
    )[:5]

    top_menu_items_payload = historical.get("top_menu_items", [])
    top_menu_items = [
        TopMenuItemSummary(
            menu_item_id=_coerce_uuid(item.get("menu_item_id")),
            menu_item_name=str(item.get("menu_item_name") or ""),
            quantity_sold=float(item.get("quantity") or 0),
        )
        for item in top_menu_items_payload[:5]
    ]

    total_dishes = historical.get("total_dishes")
    if total_dishes is None:
        total_dishes = sum(float(value or 0) for value in consumption.values())

    return PurchasingSummaryResponse(
        date_from=resolved_start,
        date_to=resolved_end,
        total_dishes_sold=float(total_dishes or 0),
        count_low=status_counts.get("LOW", 0),
        count_critical=status_counts.get("CRITICAL", 0),
        count_no_data=status_counts.get("NO_DATA", 0),
        count_ok=status_counts.get("OK", 0),
        top_ingredients=top_ingredients,
        top_menu_items=top_menu_items,
    )


@router.get("/ingredients/catalog", response_model=List[IngredientCatalogItem])
async def ingredient_catalog(dao: SupabasePurchasingDAO = Depends(get_purchasing_dao)) -> List[IngredientCatalogItem]:
    records = await dao.fetch_all_ingredients()
    return [
        IngredientCatalogItem(
            id=UUID(str(record.get("id"))),
            name=record.get("name") or "",
            unit=record.get("unit") or "",
            default_supplier_id=_coerce_uuid(record.get("default_supplier_id")) or None,
        )
        for record in records
    ]


@router.get("/menu-items", response_model=List[MenuItemSummary])
async def menu_items(dao: SupabasePurchasingDAO = Depends(get_purchasing_dao)) -> List[MenuItemSummary]:
    rows = await dao.fetch_menu_items()
    summaries: List[MenuItemSummary] = []
    for row in rows:
        identifier = _coerce_uuid(row.get("id"))
        if not identifier:
            continue
        name = row.get("display_name") or row.get("name") or "Plat"
        summaries.append(MenuItemSummary(id=identifier, name=name))
    return summaries


@router.get("/menu-items/{menu_item_id}/recipes", response_model=List[RecipeIngredientRow])
async def menu_item_recipes(
    menu_item_id: UUID,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> List[RecipeIngredientRow]:
    rows = await dao.fetch_recipes_for_menu_item(menu_item_id)
    payload: List[RecipeIngredientRow] = []
    for row in rows:
        ingredient_id = _coerce_uuid(row.get("ingredient_id"))
        if not ingredient_id:
            continue
        payload.append(
            RecipeIngredientRow(
                ingredient_id=ingredient_id,
                ingredient_name=row.get("ingredient_name") or "Ingrédient",
                unit=row.get("unit") or "",
                quantity_per_unit=float(row.get("quantity_per_unit") or 0),
            )
        )
    return payload


@router.get("/suppliers", response_model=List[SupplierSummary])
async def list_suppliers(dao: SupabasePurchasingDAO = Depends(get_purchasing_dao)) -> List[SupplierSummary]:
    rows = await dao.fetch_suppliers()
    payload: List[SupplierSummary] = []
    for row in rows:
        identifier = _coerce_uuid(row.get("id"))
        if not identifier:
            continue
        payload.append(
            SupplierSummary(
                id=identifier,
                name=row.get("name"),
                contact_email=row.get("contact_email"),
            )
        )
    return payload


@router.post("/ingredients", response_model=IngredientCatalogItem, status_code=201)
async def create_ingredient_endpoint(
    payload: IngredientCreatePayload,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> IngredientCatalogItem:
    record = await dao.create_ingredient(payload)
    identifier = _coerce_uuid(record.get("id"))
    if not identifier:
        raise HTTPException(status_code=502, detail="Réponse inattendue de Supabase.")
    return IngredientCatalogItem(
        id=identifier,
        name=record.get("name") or payload.name,
        unit=record.get("unit") or payload.unit,
        default_supplier_id=_coerce_uuid(record.get("default_supplier_id")),
    )


@router.put("/ingredients/{ingredient_id}", response_model=IngredientCatalogItem)
async def update_ingredient_endpoint(
    ingredient_id: UUID,
    payload: IngredientCreatePayload,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> IngredientCatalogItem:
    record = await dao.update_ingredient(ingredient_id, payload)
    identifier = _coerce_uuid(record.get("id")) or ingredient_id
    return IngredientCatalogItem(
        id=identifier,
        name=record.get("name") or payload.name,
        unit=record.get("unit") or payload.unit,
        default_supplier_id=_coerce_uuid(record.get("default_supplier_id")),
    )


@router.delete("/ingredients/{ingredient_id}", status_code=204)
async def delete_ingredient_endpoint(
    ingredient_id: UUID,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> None:
    await dao.delete_ingredient(ingredient_id)


# ============================================
# RECIPES ENDPOINTS
# ============================================

@router.get("/recipes", response_model=List[Dict[str, Any]])
async def get_all_recipes_with_costs(
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> List[Dict[str, Any]]:
    """Get all recipes with calculated costs and profit margins."""
    return await dao.fetch_all_recipes_with_costs()


@router.get("/recipes/{menu_item_id}", response_model=RecipeWithCostResponse)
async def get_recipe_details(
    menu_item_id: UUID,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> RecipeWithCostResponse:
    """Get detailed recipe information including ingredients with costs."""
    details = await dao.fetch_recipe_details(menu_item_id)
    if not details:
        raise HTTPException(status_code=404, detail="Recette introuvable.")
    return RecipeWithCostResponse(**details)


@router.post("/menu-items", response_model=Dict[str, Any], status_code=201)
async def create_menu_item_endpoint(
    payload: MenuItemCreatePayload,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> Dict[str, Any]:
    """Create a new menu item."""
    return await dao.create_menu_item(payload)


@router.put("/menu-items/{menu_item_id}", response_model=Dict[str, Any])
async def update_menu_item_endpoint(
    menu_item_id: UUID,
    payload: MenuItemUpdatePayload,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> Dict[str, Any]:
    """Update a menu item."""
    return await dao.update_menu_item(menu_item_id, payload)


@router.delete("/menu-items/{menu_item_id}", status_code=204)
async def delete_menu_item_endpoint(
    menu_item_id: UUID,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> None:
    """Delete a menu item and its associated recipes."""
    await dao.delete_menu_item(menu_item_id)



@router.post("/recipes", status_code=204)
async def upsert_recipe(payload: RecipeUpsertPayload, dao: SupabasePurchasingDAO = Depends(get_purchasing_dao)) -> None:
    await dao.upsert_recipe(payload)


@router.post("/sales", status_code=201)
async def record_sale(payload: ManualSalePayload, dao: SupabasePurchasingDAO = Depends(get_purchasing_dao)) -> Dict[str, Any]:
    record = await dao.record_manual_sale(payload)
    return {"id": record.get("id")}


@router.post("/purchase-orders", response_model=PurchaseOrderRecord, status_code=201)
async def create_purchase_order(
    payload: PurchaseOrderCreate,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> PurchaseOrderRecord:
    """Persist a purchase order and return the created record."""

    created = await dao.create_purchase_order_and_lines(payload)
    return PurchaseOrderRecord(**created)


@router.get("/purchase-orders/{order_id}", response_model=PurchaseOrderDetailResponse)
async def purchase_order_details(
    order_id: UUID,
    dao: SupabasePurchasingDAO = Depends(get_purchasing_dao),
) -> PurchaseOrderDetailResponse:
    """Return a purchase order with supplier metadata and an email body."""

    record = await dao.fetch_purchase_order_details(order_id)
    if not record:
        raise HTTPException(status_code=404, detail="Commande introuvable.")

    email_body = _compose_email_body(record)
    record_with_email = {**record, "email_body": email_body}
    return PurchaseOrderDetailResponse(**record_with_email)


def _resolve_date_range(
    date_from: Optional[date],
    date_to: Optional[date],
) -> tuple[date, date]:
    today = date.today()
    resolved_end = date_to or today
    resolved_start = date_from or (resolved_end - timedelta(days=6))
    if resolved_start > resolved_end:
        raise HTTPException(status_code=400, detail="La période sélectionnée est invalide.")
    return resolved_start, resolved_end


def _compute_recommendations(
    ingredients: List[Dict[str, Any]],
    consumption: Dict[Any, float],
    stock_data: Dict[Any, Dict[str, Any]],
    supplier_payload: Dict[str, Dict[Any, Dict[str, Any]]],
    date_from: date,
    date_to: date,
    reorder_cycle_days: int,
    default_lead_time_days: int,
) -> List[IngredientRecommendation]:
    ingredient_supplier_map = supplier_payload.get("ingredient_suppliers", {})
    supplier_map = supplier_payload.get("suppliers", {})
    return compute_purchase_recommendations(
        ingredients,
        consumption,
        stock_data,
        ingredient_supplier_map,
        supplier_map,
        date_from=date_from,
        date_to=date_to,
        reorder_cycle_days=reorder_cycle_days,
        default_lead_time_days=default_lead_time_days,
    )


def _coerce_uuid(value: Any) -> Optional[UUID]:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _compose_email_body(record: Dict[str, Any]) -> str:
    supplier = record.get("supplier") or {}
    supplier_name = supplier.get("name") or "Partenaire"
    lines = record.get("lines") or []
    lines_text = "\n".join(
        f"- {entry.get('ingredient_name') or entry.get('ingredient_id')}: {entry.get('quantity_ordered')} {entry.get('unit')}"
        for entry in lines
    )
    expected_date = record.get("expected_delivery_date")
    expected_text = f" pour une livraison prévue le {expected_date}" if expected_date else ""
    return (
        f"Bonjour {supplier_name},\n\n"
        f"Merci de confirmer la commande {record.get('id')}{expected_text}.\n"
        f"Voici le détail:\n{lines_text}\n\n"
        "Bien cordialement,\nL'équipe RestauBot"
    )


def _normalize_menu_document(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def _extract_menu_item_names(document: Dict[str, Any]) -> List[str]:
    categories = document.get("categories") or []
    seen: set[str] = set()
    names: List[str] = []
    for category in categories:
        items = category.get("items") or []
        for item in items:
            raw_name = str(item.get("name") or "").strip()
            if not raw_name:
                continue
            key = raw_name.lower()
            if key in seen:
                continue
            seen.add(key)
            names.append(raw_name)
            if len(names) >= 200:
                return names
    return names


@router.get("/orders", response_model=List[Dict[str, Any]])
async def get_purchase_orders(
    limit: int = Query(10, ge=1, le=50),
    restaurant_id: UUID = Depends(get_current_restaurant_id),
    access_token: str = Depends(get_access_token),
) -> List[Dict[str, Any]]:
    """
    Récupère les dernières commandes fournisseurs.
    """
    dao = SupabasePurchasingDAO(restaurant_id, access_token)
    return await dao.fetch_purchase_orders(limit=limit)


class SafetyStockUpdate(BaseModel):
    safety_stock: float = Field(..., ge=0)


@router.put("/ingredients/{ingredient_id}/stock", response_model=Dict[str, Any])
async def update_ingredient_safety_stock(
    ingredient_id: UUID,
    payload: SafetyStockUpdate,
    restaurant_id: UUID = Depends(get_current_restaurant_id),
    access_token: str = Depends(get_access_token),
) -> Dict[str, Any]:
    """
    Met à jour le stock de sécurité d'un ingrédient.
    """
    dao = SupabasePurchasingDAO(restaurant_id, access_token)
    return await dao.update_ingredient_safety_stock(ingredient_id, payload.safety_stock)


@router.delete("/ingredients/{ingredient_id}", status_code=204)
async def delete_ingredient(
    ingredient_id: UUID,
    restaurant_id: UUID = Depends(get_current_restaurant_id),
    access_token: str = Depends(get_access_token),
):
    """
    Supprime un ingrédient.
    """
    dao = SupabasePurchasingDAO(restaurant_id, access_token)
    await dao.delete_ingredient(ingredient_id)



__all__ = [
    "router",
    "get_purchasing_dao",
    "get_current_restaurant_id",
    "SupabasePurchasingDAO",
    "PurchaseOrderCreate",
]
