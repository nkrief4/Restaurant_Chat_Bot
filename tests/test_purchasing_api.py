from datetime import date
from uuid import UUID, uuid4
import os
import sys
import types

import pytest
from fastapi.testclient import TestClient

if "postgrest" not in sys.modules:
    class _DummySyncPostgrestClient:
        def __init__(self, *args, **kwargs):
            self.headers = kwargs

        def auth(self, _token: str) -> None:  # pragma: no cover - stub
            return None

    dummy_postgrest = types.ModuleType("postgrest")
    dummy_postgrest.APIError = Exception
    dummy_postgrest.SyncPostgrestClient = _DummySyncPostgrestClient
    sys.modules["postgrest"] = dummy_postgrest

if "openai" not in sys.modules:
    class _DummyChatCompletions:
        def create(self, **kwargs):
            message = types.SimpleNamespace(content="stub")
            choice = types.SimpleNamespace(message=message)
            return types.SimpleNamespace(choices=[choice])

    class _DummyChat:
        def __init__(self):
            self.completions = _DummyChatCompletions()

    class _DummyOpenAI:
        def __init__(self, *args, **kwargs):
            self.chat = _DummyChat()

    dummy_openai = types.ModuleType("openai")
    dummy_openai.APIError = Exception
    dummy_openai.OpenAI = _DummyOpenAI
    sys.modules["openai"] = dummy_openai

os.environ.setdefault("OPENAI_API_KEY", "test-key")

if "langdetect" not in sys.modules:
    class _LangDetectException(Exception):
        pass

    class _DetectorFactory:
        seed = 0

    def _detect(_text: str) -> str:
        return "fr"

    dummy_langdetect = types.ModuleType("langdetect")
    dummy_langdetect.DetectorFactory = _DetectorFactory
    dummy_langdetect.LangDetectException = _LangDetectException
    dummy_langdetect.detect = _detect
    sys.modules["langdetect"] = dummy_langdetect

if "pypdf" not in sys.modules:
    class _DummyPdfReader:
        def __init__(self, *_args, **_kwargs):
            self.pages = []

    dummy_pypdf = types.ModuleType("pypdf")
    dummy_pypdf.PdfReader = _DummyPdfReader
    sys.modules["pypdf"] = dummy_pypdf

if "multipart" not in sys.modules:
    multipart_module = types.ModuleType("multipart")
    multipart_module.__version__ = "0.0"
    multipart_submodule = types.ModuleType("multipart.multipart")

    def parse_options_header(value):  # pragma: no cover - stub implementation
        return value, {}

    multipart_submodule.parse_options_header = parse_options_header
    sys.modules["multipart"] = multipart_module
    sys.modules["multipart.multipart"] = multipart_submodule

if "supabase" not in sys.modules:
    class _DummySupabaseClient:
        def table(self, *_args, **_kwargs):  # pragma: no cover - minimal stub
            return self

        def insert(self, *_args, **_kwargs):
            return self

        def execute(self):
            return types.SimpleNamespace(data=[])

    dummy_supabase = types.ModuleType("supabase")
    dummy_supabase.Client = _DummySupabaseClient

    def _create_client(*_args, **_kwargs):  # pragma: no cover - stub factory
        return _DummySupabaseClient()

    dummy_supabase.create_client = _create_client
    sys.modules["supabase"] = dummy_supabase

if "supabase_auth" not in sys.modules:
    dummy_supabase_auth = types.ModuleType("supabase_auth")
    dummy_errors = types.ModuleType("supabase_auth.errors")
    dummy_errors.AuthApiError = Exception
    dummy_errors.AuthError = Exception
    dummy_supabase_auth.errors = dummy_errors
    sys.modules["supabase_auth"] = dummy_supabase_auth
    sys.modules["supabase_auth.errors"] = dummy_errors

from app.api.routes import purchasing as purchasing_routes
from app.api.routes.purchasing import SupabasePurchasingDAO
from app.main import app


class FakePurchasingDAO(SupabasePurchasingDAO):
    def __init__(self, restaurant_id: UUID):
        super().__init__(restaurant_id, "test-token")
        self.low_ing = uuid4()
        self.ok_ing = uuid4()
        self.supplier = uuid4()
        self.menu_item = uuid4()

    async def fetch_all_ingredients(self):
        return [
            {
                "id": self.low_ing,
                "name": "Tomate",
                "unit": "kg",
                "default_supplier_id": self.supplier,
            },
            {
                "id": str(self.ok_ing),
                "name": "Mozzarella",
                "unit": "kg",
                "default_supplier_id": str(self.supplier),
            },
        ]

    async def fetch_historical_orders_and_recipes(self, date_from: date, date_to: date):
        return {
            "consumption": {
                self.low_ing: 14.0,
                str(self.ok_ing): 2.0,
            },
            "total_dishes": 32,
            "top_menu_items": [
                {"menu_item_id": self.menu_item, "menu_item_name": "Pizza", "quantity": 24}
            ],
        }

    async def fetch_stock_data(self):
        return {
            self.low_ing: {"current_stock": 10, "safety_stock": 1},
            str(self.ok_ing): {"current_stock": 100, "safety_stock": 2},
        }

    async def fetch_supplier_and_lead_time_data(self):
        return {
            "ingredient_suppliers": {
                self.low_ing: {"supplier_id": self.supplier, "lead_time_days": 4, "supplier_name": "Primeur"}
            },
            "suppliers": {
                self.supplier: {"name": "Primeur", "default_lead_time_days": 6}
            },
        }

    async def fetch_suppliers(self):
        return []

    async def fetch_menu_items(self):
        return []

    async def fetch_recipes_for_menu_item(self, menu_item_id: UUID):
        return []


@pytest.fixture(name="api_client")
def client_fixture():
    restaurant_id = uuid4()
    fake_dao = FakePurchasingDAO(restaurant_id)

    async def override_restaurant_id():
        return restaurant_id

    async def override_dao():
        return fake_dao

    app.dependency_overrides[purchasing_routes.get_current_restaurant_id] = override_restaurant_id
    app.dependency_overrides[purchasing_routes.get_purchasing_dao] = override_dao

    with TestClient(app) as client:
        client.restaurant_id = restaurant_id  # type: ignore[attr-defined]
        yield client

    app.dependency_overrides.clear()


def test_get_ingredients_returns_low_and_ok(api_client: TestClient) -> None:
    response = api_client.get(
        "/api/purchasing/ingredients",
        params={"date_from": "2024-05-01", "date_to": "2024-05-07"},
        headers={
          "Authorization": "Bearer test-token",
          "X-Restaurant-Id": str(getattr(api_client, "restaurant_id", "")),
        },
    )
    assert response.status_code == 200

    payload = response.json()
    assert len(payload) == 2
    status_by_name = {entry["ingredient_name"]: entry["status"] for entry in payload}
    assert status_by_name["Tomate"] == "LOW"
    assert status_by_name["Mozzarella"] == "OK"
