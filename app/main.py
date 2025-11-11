"""FastAPI application exposing chat endpoint and serving static frontend."""

import sys
from pathlib import Path
from typing import Any, Dict

sys.path.append(str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.services.chat_service import get_chat_response

app = FastAPI(title="Restaurant Chatbot")

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
INDEX_FILE = STATIC_DIR / "index.html"

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatRequest(BaseModel):
    message: str


@app.get("/", response_class=FileResponse)
def read_index() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest) -> Dict[str, str]:
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Le message ne peut pas être vide.")
    reply = await get_chat_response(request.message)
    return {"reply": reply}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
