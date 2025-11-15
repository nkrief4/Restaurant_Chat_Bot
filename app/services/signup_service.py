"""Secure orchestration of the public signup flow."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional, Annotated

from postgrest import APIError as PostgrestAPIError
from supabase import Client
from supabase_auth.errors import AuthApiError, AuthError
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    ConfigDict,
    StringConstraints,
)
from pydantic.functional_validators import field_validator, model_validator
from pydantic import FieldValidationInfo
from app.config.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


class SignupError(RuntimeError):
    """Base class for signup failures."""


class SignupValidationError(SignupError):
    """Raised when user-provided data cannot be accepted."""


@dataclass(frozen=True)
class SignupResult:
    """Artifacts created during the signup workflow."""

    user_id: str
    tenant_id: str
    restaurant_id: str


class SignupPayload(BaseModel):
    """Expected payload for the registration endpoint."""

    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = None
    company_name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = None
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=8, max_length=72)]
    restaurant_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    restaurant_slug: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]] = None
    use_case: Literal["single_location", "multi_location", "agency", "other"] = "single_location"
    preferred_language: Literal["fr", "en"] = "fr"
    newsletter_opt_in: bool = False
    terms_accepted: bool = Field(..., description="Le champ doit être accepté pour poursuivre.")
    referral_code: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]] = None
    menu_document: Optional[Dict[str, Any]] = None

    @field_validator("restaurant_name", mode="before")
    @classmethod
    def _clean_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Le nom du restaurant doit contenir au moins 2 caractères.")
        return cleaned

    @field_validator("restaurant_slug", mode="before")
    @classmethod
    def _normalize_slug(cls, value: Optional[str], info: FieldValidationInfo) -> str:
        base_value = value or info.data.get("restaurant_name") or "restaurant"
        slug = slugify(base_value)
        if len(slug) < 3:
            raise ValueError("Le slug doit contenir au moins 3 caractères alphanumériques.")
        return slug

    @model_validator(mode="after")
    @classmethod
    def _ensure_terms(cls, payload: "SignupPayload") -> "SignupPayload":
        if not payload.terms_accepted:
            raise ValueError("Vous devez accepter les conditions d'utilisation.")
        return payload

    @field_validator("menu_document", mode="before")
    @classmethod
    def _parse_menu(cls, value: Any) -> Any:
        if isinstance(value, str) and value.strip():
            try:
                return json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("Le menu structuré doit être un JSON valide.") from exc
        return value


SignupPayload.model_rebuild()


async def execute_signup(payload: SignupPayload) -> SignupResult:
    """Entry point used by the FastAPI route."""

    client = get_supabase_client()
    if client is None:
        raise SignupError("Supabase n'est pas configuré côté serveur.")
    return await asyncio.to_thread(_run_signup, client, payload)


def slugify(value: str) -> str:
    """Convert user input to a lowercase slug without accents."""

    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_only.lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return cleaned or "restaurant"


def _run_signup(client: Client, payload: SignupPayload) -> SignupResult:
    slug = payload.restaurant_slug or slugify(payload.restaurant_name)
    _ensure_slug_available(client, slug)

    tenant_id = None
    user_id = None
    restaurant_id = None

    try:
        tenant_id = _create_tenant(client, payload, slug)
        user_id = _create_user(client, payload, tenant_id, slug)
        _link_user_to_tenant(client, user_id, tenant_id)
        restaurant_id = _create_restaurant(client, payload, tenant_id, slug)
        return SignupResult(user_id=user_id, tenant_id=tenant_id, restaurant_id=restaurant_id)
    except SignupValidationError:
        raise
    except (AuthError, AuthApiError) as exc:
        logger.info("Supabase auth rejected signup: %s", exc)
        raise SignupValidationError(str(exc)) from exc
    except PostgrestAPIError as exc:
        logger.error("Supabase data layer rejected signup: %s", exc)
        raise SignupError("Impossible d'enregistrer vos informations pour le moment.") from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Unexpected error during signup")
        raise SignupError("Erreur inattendue lors de votre inscription.") from exc
    finally:
        if restaurant_id is None:
            _rollback(client, tenant_id=tenant_id, user_id=user_id, restaurant_id=restaurant_id)


def _ensure_slug_available(client: Client, slug: str) -> None:
    response = (
        client.table("restaurants")
        .select("id")
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if response.data:
        raise SignupValidationError("Ce slug est déjà utilisé par un restaurant existant.")


def _create_tenant(client: Client, payload: SignupPayload, slug: str) -> str:
    insert_payload = {
        "name": payload.restaurant_name,
    }
    response = client.table("tenants").insert(insert_payload).execute()
    tenant_row = _first_row(response.data)
    tenant_id = tenant_row.get("id")
    if not tenant_id:
        raise SignupError("Supabase n'a pas renvoyé d'identifiant de tenant.")
    return tenant_id


def _create_user(client: Client, payload: SignupPayload, tenant_id: str, tenant_slug: str) -> str:
    metadata = {
        "full_name": payload.full_name,
        "company_name": payload.company_name,
        "tenant_id": tenant_id,
        "tenant_slug": tenant_slug,
        "use_case": payload.use_case,
        "preferred_language": payload.preferred_language,
        "newsletter_opt_in": payload.newsletter_opt_in,
        "referral_code": payload.referral_code,
    }
    clean_metadata = {k: v for k, v in metadata.items() if v not in (None, "")}
    response = client.auth.admin.create_user(
        {
            "email": payload.email,
            "password": payload.password,
            "email_confirm": True,
            "user_metadata": clean_metadata,
        }
    )
    user = response.user
    if not user or not user.id:
        raise SignupError("Impossible de récupérer l'identifiant utilisateur Supabase.")
    return user.id


def _link_user_to_tenant(client: Client, user_id: str, tenant_id: str) -> None:
    payload = {"user_id": user_id, "tenant_id": tenant_id}
    client.table("user_tenants").insert(payload).execute()


def _create_restaurant(client: Client, payload: SignupPayload, tenant_id: str, slug: str) -> str:
    menu_document = payload.menu_document or {"categories": []}
    insert_payload = {
        "tenant_id": tenant_id,
        "display_name": payload.restaurant_name,
        "slug": slug,
        "menu_document": menu_document,
    }
    response = client.table("restaurants").insert(insert_payload).execute()
    restaurant_data = response.data or []
    if not restaurant_data:
        restaurant_data = (
            client.table("restaurants")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("slug", slug)
            .limit(1)
            .execute()
            .data
            or []
        )
    restaurant_row = _first_row(restaurant_data)
    restaurant_id = restaurant_row.get("id")
    if not restaurant_id:
        raise SignupError("Impossible de récupérer l'identifiant du restaurant initial.")
    return restaurant_id


def _first_row(data: Optional[Any]) -> Dict[str, Any]:
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            return first
    raise SignupError("Supabase n'a renvoyé aucune donnée après l'insertion.")


def _rollback(
    client: Client,
    *,
    tenant_id: Optional[str],
    user_id: Optional[str],
    restaurant_id: Optional[str],
) -> None:
    """Attempt best-effort cleanup if the workflow failed midway."""

    if user_id or tenant_id:
        try:
            query = client.table("user_tenants").delete()
            if user_id:
                query = query.eq("user_id", user_id)
            if tenant_id:
                query = query.eq("tenant_id", tenant_id)
            query.execute()
        except Exception:  # pragma: no cover - best effort cleanup
            logger.warning(
                "Unable to rollback user_tenants link (user=%s, tenant=%s)",
                user_id,
                tenant_id,
                exc_info=True,
            )

    if restaurant_id:
        try:
            client.table("restaurants").delete().eq("id", restaurant_id).execute()
        except Exception:  # pragma: no cover - best effort cleanup
            logger.warning("Unable to rollback restaurant %s", restaurant_id, exc_info=True)

    if user_id:
        try:
            client.auth.admin.delete_user(user_id)
        except Exception:  # pragma: no cover - best effort cleanup
            logger.warning("Unable to rollback user %s", user_id, exc_info=True)

    if tenant_id:
        try:
            client.table("tenants").delete().eq("id", tenant_id).execute()
        except Exception:  # pragma: no cover - best effort cleanup
            logger.warning("Unable to rollback tenant %s", tenant_id, exc_info=True)
