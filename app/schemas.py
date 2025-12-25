from typing import Any, Dict, List, Literal, Optional, Annotated
from uuid import UUID
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    StringConstraints,
    ConfigDict,
    model_serializer,
    model_validator,
)

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


class MenuTag(BaseModel):
    model_config = ConfigDict(extra="allow")
    label: str
    type: Optional[str] = Field(default="custom")

    @model_validator(mode="before")
    @classmethod
    def _coerce_to_struct(cls, value: Any) -> Dict[str, str]:
        if isinstance(value, MenuTag):
            return value.model_dump()
        if isinstance(value, str):
            return {"label": value, "type": "custom"}
        if isinstance(value, dict):
            data = dict(value)
            label = data.get("label") or data.get("name") or data.get("value")
            if not label:
                raise ValueError("Chaque tag doit contenir un label.")
            data["label"] = label
            data.setdefault("type", "custom")
            return data
        if value is None:
            raise ValueError("Tag manquant ou invalide.")
        return {"label": str(value), "type": "custom"}

    @model_serializer(mode="plain")
    def _serialize_label(self) -> str:
        return self.label


class MenuItemSchema(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    tags: List[MenuTag] = Field(default_factory=list)
    contains: List[str] = Field(default_factory=list)
    image_url: Optional[str] = None
    ingredient_ids: List[str] = Field(default_factory=list)


class MenuCategorySchema(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    items: List[MenuItemSchema] = Field(default_factory=list)


class MenuDocumentSchema(BaseModel):
    model_config = ConfigDict(extra="allow")
    categories: List[MenuCategorySchema] = Field(default_factory=list)
    last_updated: Optional[str] = None


class RestaurantUpsertPayload(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=120, description="Nom public du restaurant")
    slug: str = Field(..., min_length=2, max_length=120, description="Identifiant unique utilisé pour le partage")
    menu_document: MenuDocumentSchema = Field(
        default_factory=MenuDocumentSchema,
        description="Menu structuré optionnel",
    )

    @model_validator(mode="before")
    @classmethod
    def _default_menu_document(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw_menu = data.get("menu_document")
            if not raw_menu:
                data["menu_document"] = MenuDocumentSchema()
        return data


class ProfileUpdatePayload(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)
    country: Optional[str] = Field(default=None, max_length=120)
    timezone: Optional[str] = Field(default=None, max_length=64)
    phone_number: Optional[str] = Field(default=None, max_length=32)

