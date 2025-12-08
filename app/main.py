"""FastAPI application exposing chat endpoint and serving static frontend."""

import logging
import sys
from pathlib import Path
from typing import Dict

sys.path.append(str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config.supabase_client import SUPABASE_ANON_KEY, SUPABASE_URL
from app.api.routes.auth import router as auth_router
from app.api.routes.chat import router as chat_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.public import router as public_router
from app.api.routes.purchasing import router as purchasing_router
from app.api.routes.sales import router as sales_router
from app.api.routes.ingredient_categories import router as ingredient_categories_router

app = FastAPI(title="Restaurant Chatbot")
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"

# Files moved to templates or static as appropriate
INDEX_FILE = TEMPLATES_DIR / "index.html"
LOGIN_FILE = TEMPLATES_DIR / "login.html"
SIGNUP_FILE = TEMPLATES_DIR / "signup.html"
DASHBOARD_FILE = TEMPLATES_DIR / "dashboard.html"
CHAT_FILE = TEMPLATES_DIR / "chat.html"
PURCHASING_FILE = TEMPLATES_DIR / "purchasing.html"
ORDER_DETAILS_FILE = TEMPLATES_DIR / "order_details.html"

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Include Routers
app.include_router(purchasing_router)
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(chat_router, prefix="/api", tags=["Chat"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(public_router, prefix="/api", tags=["Public"])
app.include_router(sales_router)
app.include_router(ingredient_categories_router)



@app.get("/", response_class=FileResponse)
def read_index() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/login", response_class=FileResponse)
def read_login() -> FileResponse:
    return FileResponse(LOGIN_FILE)


@app.get("/signup", response_class=FileResponse)
def read_signup() -> FileResponse:
    return FileResponse(SIGNUP_FILE)


@app.get("/dashboard")
async def read_dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/purchasing", response_class=FileResponse)
def read_purchasing() -> FileResponse:
    return FileResponse(PURCHASING_FILE)


@app.get("/purchasing/orders/{order_id}", response_class=FileResponse)
def read_order_details(order_id: str) -> FileResponse:
    return FileResponse(ORDER_DETAILS_FILE)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def supabase_config() -> Dict[str, str]:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase configuration missing.")
    return {"supabaseUrl": SUPABASE_URL, "supabaseAnonKey": SUPABASE_ANON_KEY}


@app.get("/chat", include_in_schema=False)
def deprecated_chat() -> None:
    raise HTTPException(status_code=404, detail="Le chatbot est disponible depuis le dashboard.")


@app.get("/dashboard/chat", response_class=FileResponse)
@app.get("/dashboard/chat.html", response_class=FileResponse)
def read_dashboard_chat() -> FileResponse:
    return FileResponse(CHAT_FILE)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
