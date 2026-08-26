from typing import Optional
from fastapi import Header, HTTPException, status, Security
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from app.config import settings
from app.services.omnivista_service import omnivista_service, OmniVistaService

api_key_header = APIKeyHeader(name="X-API-KEY", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)


def verify_api_key(
    x_api_key: Optional[str] = Security(api_key_header),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth)
):
    """
    Valida que las peticiones al backend cuenten con la clave de seguridad configurada en API_SECRET_KEY.
    Si API_SECRET_KEY está vacía en el archivo .env, el acceso es público (modo desarrollo).
    """
    secret = settings.API_SECRET_KEY
    if not secret:
        return True  # Modo desarrollo: sin autenticación requerida

    token_provided = x_api_key or (auth_credentials.credentials if auth_credentials else None)

    if not token_provided or token_provided != secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Acceso no autorizado. Se requiere un 'X-API-KEY' o token Bearer válido.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


def get_ov_service() -> OmniVistaService:
    """Inyector del servicio OmniVista"""
    return omnivista_service
