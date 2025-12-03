from uuid import UUID
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import EmailStr

from app.schemas import LoginPayload, LoginSuccessResponse, SignupSuccessResponse
from app.services.auth_service import (
    AuthenticationError,
    InvalidCredentials,
    login_with_password,
)
from app.services.signup_service import (
    SignupError,
    SignupPayload,
    SignupValidationError,
    execute_signup,
)
from app.security.guards import enforce_same_origin, rate_limit_request

router = APIRouter()

@router.post("/signup", response_model=SignupSuccessResponse)
async def signup_endpoint(payload: SignupPayload, request: Request) -> SignupSuccessResponse:
    enforce_same_origin(request)
    rate_limit_request(request, scope="signup", limit=3, window_seconds=300)
    try:
        result = await execute_signup(payload)
    except SignupValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SignupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        tenant_uuid = UUID(result.tenant_id)
        restaurant_uuid = UUID(result.restaurant_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Identifiants Supabase invalides.") from exc

    return SignupSuccessResponse(
        message="Votre espace restaurateur est prêt. Vous pouvez accéder au tableau de bord.",
        email=payload.email,
        tenant_id=tenant_uuid,
        restaurant_id=restaurant_uuid,
    )


@router.post("/login", response_model=LoginSuccessResponse)
async def login_endpoint(payload: LoginPayload, request: Request) -> LoginSuccessResponse:
    enforce_same_origin(request)
    rate_limit_request(request, scope="login", limit=5, window_seconds=60)

    try:
        session = await login_with_password(payload.email, payload.password)
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return LoginSuccessResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
        expires_at=session.expires_at,
    )
