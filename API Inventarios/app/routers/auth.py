from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.errors import InventoryError
from app.core.security import key_principal
from app.core.sessions import get_totp_secret_for_account, get_totp_uri, verify_totp_code, create_jwt_session, decode_jwt_session

router = APIRouter(prefix='/auth', tags=['Autenticación y 2FA'])


class Credentials(BaseModel):
    """Credenciales de operador para consultar o enrolar autenticación adicional."""

    api_key: str = Field(min_length=1, max_length=4096, description='Clave API del operador; no se devuelve en respuestas ni auditorías.')
    account_name: str = Field('NOC-Operator', pattern=r'^[a-zA-Z0-9._@-]{1,64}$', description='Identificador lógico de la cuenta TOTP.')


class Verify(Credentials):
    """Credenciales de operador más el código TOTP vigente."""

    totp_code: str = Field(pattern=r'^\d{6}$', description='Código TOTP de seis dígitos generado por el autenticador.')


@router.get('/status', summary='Estado de autenticación', description='Describe el modo activo de autenticación y la duración de sesiones sin exponer secretos.')
def status():
    return {'success': True, 'mode': '2FA_TOTP' if settings.ENABLE_2FA else 'API_KEY', '2fa_enabled': settings.ENABLE_2FA,
            'session_expire_hours': settings.SESSION_EXPIRE_HOURS}


def operator(body):
    principal = key_principal(body.api_key)
    if not principal or principal.dashboard:
        raise InventoryError(401, 'Credencial de operador no válida.')
    return principal


@router.post('/setup-2fa', summary='Preparar enrolamiento 2FA', description='Genera el secreto y URI otpauth para una cuenta. Solo funciona cuando el enrolamiento 2FA fue habilitado explícitamente.')
def setup(body: Credentials):
    if not settings.ENABLE_2FA or not settings.ALLOW_2FA_ENROLLMENT:
        raise InventoryError(403, 'Enrolamiento 2FA deshabilitado.')
    operator(body)
    secret = get_totp_secret_for_account(body.api_key, body.account_name)
    return {'success': True, 'secret': secret, 'otpauth_uri': get_totp_uri(secret, body.account_name), 'issuer': 'SGRS-Inventarios'}


@router.post('/verify-2fa', summary='Verificar código 2FA', description='Valida el código TOTP del operador y devuelve una sesión Bearer temporal.')
def verify(body: Verify):
    if not settings.ENABLE_2FA:
        raise InventoryError(404, '2FA deshabilitado.')
    principal = operator(body)
    secret = get_totp_secret_for_account(body.api_key, body.account_name)
    if not verify_totp_code(secret, body.totp_code):
        raise InventoryError(401, 'Código 2FA no válido.')
    return {'success': True, 'access_token': create_jwt_session(principal.subject + ':' + body.account_name),
            'token_type': 'bearer', 'expires_in_seconds': settings.SESSION_EXPIRE_HOURS * 3600}


class Token(BaseModel):
    """Sesión Bearer emitida por el flujo 2FA."""

    token: str = Field(max_length=4096, description='Token de sesión que se desea validar.')


@router.post('/verify-token', summary='Verificar sesión', description='Valida una sesión Bearer emitida por el flujo 2FA y devuelve sus claims operativos.')
def verify_token(body: Token):
    payload = decode_jwt_session(body.token) if settings.ENABLE_2FA else None
    if not payload:
        raise InventoryError(401, 'Sesión no válida.')
    return {'success': True, 'data': payload}
