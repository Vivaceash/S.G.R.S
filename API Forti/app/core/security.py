from typing import Optional
from fastapi import HTTPException, Security, status, Request
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Header para autenticación de clientes de nuestra API
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# Configuración del Limiter para protección anti-abuso / DoS
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"]
)


async def verify_api_key(api_key: Optional[str] = Security(api_key_header)) -> Optional[str]:
    """
    Verifica que el cliente envíe un X-API-Key válido.
    Si APP_API_KEY no está configurado o está vacío en .env, se omite la validación (modo abierto).
    """
    if not settings.APP_API_KEY:
        return None

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "Authentication required",
                "message": f"Cabecera '{API_KEY_NAME}' no proporcionada o inválida."
            },
            headers={"WWW-Authenticate": API_KEY_NAME}
        )

    if api_key != settings.APP_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "Forbidden",
                "message": "Clave de API no válida para este servicio."
            }
        )

    return api_key
