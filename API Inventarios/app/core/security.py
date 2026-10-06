import hashlib
import secrets
from dataclasses import dataclass
from fastapi import Depends, Request, Security
from fastapi.security import APIKeyHeader, HTTPBearer
from app.core.config import settings
from app.core.errors import InventoryError
from app.core.sessions import decode_jwt_session

header = APIKeyHeader(name='X-API-Key', auto_error=False)
bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    subject: str
    scopes: set
    dashboard: bool = False


def key_principal(token):
    if not token:
        return None
    for value, scopes, dashboard in (
        (settings.API_KEYS, {'read'}, False),
        (settings.EXPORT_KEYS, {'read', 'export'}, False),
        (settings.WRITE_KEYS, {'read', 'write', 'export'}, False),
        (settings.DASHBOARD_KEY, {'read', 'write', 'export'}, True),
    ):
        for key in settings.keys(value):
            if secrets.compare_digest(token.encode(), key.encode()):
                return Principal('key:' + hashlib.sha256(key.encode()).hexdigest()[:16], scopes, dashboard)
    return None


async def authenticate(request: Request, api_key=Security(header), credentials=Security(bearer)):
    token = api_key or (credentials.credentials if credentials else '')
    principal = key_principal(token)
    if principal and (principal.dashboard or not settings.ENABLE_2FA):
        # Only the dedicated backend identity may delegate an end-user actor.
        actor = request.headers.get('X-Inventory-Actor', '')
        if principal.dashboard and actor:
            if len(actor) > 120 or not actor.isprintable():
                raise InventoryError(422, 'Actor no válido.')
            principal.subject = 'dashboard:' + actor
        return principal
    payload = decode_jwt_session(token) if settings.ENABLE_2FA else None
    if payload:
        # The subject is a bound key identity + account, never a client-supplied scope.
        for raw in (settings.API_KEYS, settings.EXPORT_KEYS, settings.WRITE_KEYS):
            for key in settings.keys(raw):
                candidate = key_principal(key)
                if payload['sub'].startswith(candidate.subject + ':'):
                    candidate.subject = payload['sub']
                    return candidate
    raise InventoryError(401, 'Credencial ausente, inválida o sesión 2FA requerida.', 'unauthorized')


def require(scope):
    def dependency(principal=Depends(authenticate)):
        if scope not in principal.scopes:
            raise InventoryError(403, 'La credencial no permite esta operación.', 'forbidden')
        return principal
    return dependency
