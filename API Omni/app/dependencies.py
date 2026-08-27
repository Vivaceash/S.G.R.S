import secrets
from typing import Optional
from fastapi import HTTPException, status, Security, Request
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from app.config import settings
from app.services.omnivista_service import omnivista_service, OmniVistaService
from app.security.logging import log_security_event

api_key_header = APIKeyHeader(name="X-API-KEY", auto_error=False, description="Clave de API enviada en cabecera X-API-KEY")
api_key_header_lower = APIKeyHeader(name="X-API-Key", auto_error=False, description="Clave de API enviada en cabecera X-API-Key")
bearer_auth = HTTPBearer(auto_error=False, description="Token Bearer de autenticación")


def verify_api_key(
    request: Request,
    x_api_key: Optional[str] = Security(api_key_header),
    x_api_key_alt: Optional[str] = Security(api_key_header_lower),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth),
) -> bool:
    """
    Valida de forma segura y en tiempo constante (evitando Timing Attacks)
    que la petición incluya una clave válida configurada en APP_API_KEY o API_SECRET_KEY.
    Registra eventos de auditoría de seguridad estructurados.
    """
    # Si explícitamente se habilitó el modo no autenticado para pruebas locales
    if settings.ALLOW_UNAUTHENTICATED:
        return True

    client_ip = request.client.host if request.client else "unknown"
    req_id = getattr(request.state, "request_id", "N/A")

    # Si no hay claves configuradas en el servidor, falla cerrada por seguridad
    valid_keys = settings.api_keys
    if not valid_keys:
        log_security_event(
            "auth_misconfiguration",
            {"ip": client_ip, "path": request.url.path, "req_id": req_id, "reason": "no_keys_configured"},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El servidor no tiene configurada una clave de seguridad (APP_API_KEY). Contacte al administrador.",
        )

    token_provided = x_api_key or x_api_key_alt or (auth_credentials.credentials if auth_credentials else None)

    if not token_provided:
        log_security_event(
            "auth_missing_token",
            {"ip": client_ip, "path": request.url.path, "req_id": req_id},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Acceso no autorizado. Se requiere cabecera 'X-API-KEY', 'X-API-Key' o 'Authorization: Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_clean = token_provided.strip().strip('"').strip("'")

    # Comparación segura en tiempo constante contra todas las claves válidas
    is_valid = any(
        secrets.compare_digest(token_clean, key)
        for key in valid_keys
    )

    if not is_valid:
        log_security_event(
            "auth_invalid_key",
            {"ip": client_ip, "path": request.url.path, "req_id": req_id},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clave de API no válida o expirada.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True


def get_ov_service() -> OmniVistaService:
    """Inyector del servicio OmniVista"""
    return omnivista_service
