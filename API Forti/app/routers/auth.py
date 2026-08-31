import base64
import secrets
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, status, Request

from app.core.config import settings
from app.core.security import (
    generate_totp_secret,
    get_totp_secret_for_account,
    get_totp_uri,
    verify_totp_code,
    create_jwt_session,
    decode_jwt_session,
)
from app.security.logging import log_security_event

router = APIRouter(
    prefix="/auth",
    tags=["Autenticación y 2FA (TOTP)"],
)


class Setup2FARequest(BaseModel):
    api_key: str = Field(..., description="Clave de API de administrador para autorizar el enrolamiento")
    account_name: Optional[str] = Field(
        "NOC-Operator", min_length=1, max_length=64,
        pattern=r"^[a-zA-Z0-9._@\-]+$", description="Nombre del operador o estación",
    )


class Setup2FAResponse(BaseModel):
    success: bool
    secret: str = Field(..., description="Secreto Base32 para ingresar manualmente en la app de 2FA")
    otpauth_uri: str = Field(..., description="URI estándar para generar código QR en la aplicación autenticadora")
    issuer: str
    algorithm: str = "SHA1"
    digits: int = 6
    period: int = 30


class Verify2FARequest(BaseModel):
    api_key: str = Field(..., description="Clave de API configurada en el servidor")
    totp_code: str = Field(..., min_length=6, max_length=6, description="Código de 6 dígitos de Google Authenticator / Microsoft Authenticator")
    account_name: Optional[str] = Field(
        "NOC-Operator", min_length=1, max_length=64,
        pattern=r"^[a-zA-Z0-9._@\-]+$", description="Nombre del operador",
    )


class Verify2FAResponse(BaseModel):
    success: bool
    access_token: str = Field(..., description="Token Bearer de sesión JWT para autorizar consultas")
    token_type: str = "bearer"
    expires_in_seconds: int


class VerifyTokenRequest(BaseModel):
    token: str = Field(..., description="Token JWT de sesión a verificar")


@router.get("/status", summary="Consultar estado del mecanismo de autenticación")
async def get_auth_status():
    """Retorna si la autenticación en dos pasos (2FA) está activa y las políticas de sesión."""
    return {
        "success": True,
        "mode": "2FA_TOTP" if settings.ENABLE_2FA else "API_KEY",
        "2fa_enabled": settings.ENABLE_2FA,
        "session_expire_hours": settings.SESSION_EXPIRE_HOURS,
        "supported_auth_headers": ["X-API-Key", "X-API-KEY", "Authorization: Bearer <token>"],
    }


@router.post("/setup-2fa", response_model=Setup2FAResponse, summary="Generar credencial de enrolamiento 2FA")
async def setup_2fa(payload: Setup2FARequest, request: Request):
    """
    Genera un secreto TOTP Base32 y una URI estándar para enrolar Google/Microsoft Authenticator.
    Requiere la clave maestra de API para autorizar el enrolamiento.
    """
    if not settings.ENABLE_2FA or not settings.ALLOW_2FA_ENROLLMENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El enrolamiento 2FA no está habilitado por el administrador.",
        )

    client_ip = request.client.host if request.client else "unknown"
    valid_keys = settings.api_keys

    # Validar API key en tiempo constante
    clean_key = payload.api_key.strip().strip('"').strip("'")
    if not any(secrets.compare_digest(clean_key, k) for k in valid_keys):
        log_security_event("setup_2fa_rejected", {"ip": client_ip, "reason": "invalid_api_key"})
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clave de API no válida para configurar 2FA.",
        )

    account = payload.account_name or "NOC-Operator"
    secret = get_totp_secret_for_account(clean_key, account)
    issuer = "SGRS-Fortinet"
    uri = get_totp_uri(secret=secret, account_name=account, issuer=issuer)

    log_security_event("setup_2fa_generated", {"ip": client_ip, "account": account})

    return Setup2FAResponse(
        success=True,
        secret=secret,
        otpauth_uri=uri,
        issuer=issuer,
    )


@router.post("/verify-2fa", response_model=Verify2FAResponse, summary="Validar código 2FA y emitir token de sesión")
async def verify_2fa(payload: Verify2FARequest, request: Request):
    """
    Valida la clave de API junto con el código TOTP de 6 dígitos.
    Si ambos son correctos, emite un token de sesión JWT con validez temporal para el Dashboard.
    """
    if not settings.ENABLE_2FA:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="2FA no está habilitado.")

    client_ip = request.client.host if request.client else "unknown"
    req_id = getattr(request.state, "request_id", "no_id")

    # 1. Validar API Key
    clean_key = payload.api_key.strip().strip('"').strip("'")
    if not any(secrets.compare_digest(clean_key, k) for k in settings.api_keys):
        log_security_event("verify_2fa_failed", {"ip": client_ip, "reason": "invalid_api_key", "req_id": req_id})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clave de API incorrecta.",
        )

    account = payload.account_name or "NOC-Operator"
    secret = get_totp_secret_for_account(clean_key, account)

    # 2. Validar código TOTP
    is_valid_totp = verify_totp_code(secret=secret, code=payload.totp_code)
    if not is_valid_totp:
        log_security_event("verify_2fa_failed", {"ip": client_ip, "reason": "invalid_totp_code", "req_id": req_id})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código de autenticación 2FA incorrecto o expirado.",
        )

    # 3. Generar token JWT de sesión
    session_token = create_jwt_session(
        subject=account,
        is_2fa_verified=True,
        expires_hours=settings.SESSION_EXPIRE_HOURS,
    )

    log_security_event("verify_2fa_success", {"ip": client_ip, "account": account, "req_id": req_id})

    return Verify2FAResponse(
        success=True,
        access_token=session_token,
        token_type="bearer",
        expires_in_seconds=settings.SESSION_EXPIRE_HOURS * 3600,
    )


@router.post("/verify-token", summary="Comprobar validez de un token JWT de sesión")
async def verify_session_token(payload: VerifyTokenRequest):
    """Comprueba si un token de sesión JWT sigue activo y vigente."""
    if not settings.ENABLE_2FA:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Las sesiones 2FA no están habilitadas.")
    token_data = decode_jwt_session(payload.token)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de sesión no válido o expirado.",
        )
    return {
        "valid": True,
        "data": token_data,
    }
