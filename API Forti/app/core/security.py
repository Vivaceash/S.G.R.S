import secrets
from typing import Optional
from fastapi import HTTPException, Security, status, Request
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings
from app.security.logging import log_security_event

# Headers admitidos para autenticación de clientes de nuestra API
API_KEY_HEADER_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_HEADER_NAME, auto_error=False, description="Clave enviada en header X-API-Key")
api_key_header_upper = APIKeyHeader(name="X-API-KEY", auto_error=False, description="Clave enviada en header X-API-KEY")
bearer_auth = HTTPBearer(auto_error=False, description="Token enviado como Bearer")

# Configuración del Limiter de slowapi (para compatibilidad)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
)


async def verify_api_key(
    request: Request,
    api_key_1: Optional[str] = Security(api_key_header),
    api_key_2: Optional[str] = Security(api_key_header_upper),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth),
) -> Optional[str]:
    """
    Verifica de forma segura y en tiempo constante (protección anti Timing Attacks)
    que la solicitud incluya una clave válida configurada en APP_API_KEY o API_SECRET_KEY.
    Admite cabeceras 'X-API-Key', 'X-API-KEY' y 'Authorization: Bearer <key>'.
    """
    # Si explícitamente se habilitó el modo no autenticado para desarrollo
    if settings.ALLOW_UNAUTHENTICATED:
        return "unauthenticated_dev_mode"

    client_ip = request.client.host if request.client else "unknown"
    req_id = getattr(request.state, "request_id", "no_id")

    valid_keys = settings.api_keys
    if not valid_keys:
        if settings.ENVIRONMENT == "production":
            log_security_event(
                "auth_misconfiguration",
                {"ip": client_ip, "path": request.url.path, "reason": "no_keys_configured"},
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="El servidor no tiene configurada ninguna clave de API válida. Contacte al administrador.",
            )
        # En desarrollo, si no hay clave configurada se permite omitir
        return None

    # Extraer el token provisto desde cualquiera de los esquemas válidos
    token_provided = api_key_1 or api_key_2 or (auth_credentials.credentials if auth_credentials else None)

    if not token_provided:
        log_security_event(
            "auth_missing",
            {"ip": client_ip, "path": request.url.path, "request_id": req_id},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "Authentication required",
                "message": f"Cabecera '{API_KEY_HEADER_NAME}' o 'Authorization: Bearer <token>' no proporcionada.",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    clean_token = token_provided.strip().strip('"').strip("'")

    # Comparación segura en tiempo constante contra todas las claves registradas
    is_valid = any(secrets.compare_digest(clean_token, valid_key) for valid_key in valid_keys)

    if not is_valid:
        log_security_event(
            "auth_failed",
            {"ip": client_ip, "path": request.url.path, "request_id": req_id, "token_prefix": clean_token[:4]},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "Forbidden",
                "message": "Clave de API no válida o expirada para este servicio.",
            },
        )

    return clean_token
