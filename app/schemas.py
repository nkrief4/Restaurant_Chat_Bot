from typing import Any, Dict, List, Literal, Optional, Annotated
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, StringConstraints

class ChatMessagePayload(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    restaurant_id: UUID
    message: str
    history: List[ChatMessagePayload] = Field(default_factory=list)
    session_id: Optional[UUID] = Field(default=None, description="Identifiant de session conversationnelle")


class MenuUploadResponse(BaseModel):
    menu_document: Dict[str, Any]


class PublicRestaurantResponse(BaseModel):
    id: UUID
    display_name: Optional[str] = None
    name: Optional[str] = None
    slug: Optional[str] = None
    menu_document: Dict[str, Any]


class SignupSuccessResponse(BaseModel):
    message: str
    email: EmailStr
    tenant_id: UUID
    restaurant_id: UUID
    auto_login: bool = True


class LoginPayload(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=8, max_length=72)]


class LoginSuccessResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    expires_at: int


class RestaurantUpsertPayload(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=120, description="Nom public du restaurant")
    slug: str = Field(..., min_length=2, max_length=120, description="Identifiant unique utilisé pour le partage")
    menu_document: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Menu structuré optionnel",
    )


class ProfileUpdatePayload(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)
    country: Optional[str] = Field(default=None, max_length=120)
    timezone: Optional[str] = Field(default=None, max_length=64)
    phone_number: Optional[str] = Field(default=None, max_length=32)


