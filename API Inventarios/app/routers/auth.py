from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.errors import InventoryError
from app.core.security import key_principal
from app.core.sessions import get_totp_secret_for_account, get_totp_uri, verify_totp_code, create_jwt_session, decode_jwt_session

router = APIRouter(prefix='/auth', tags=['Autenticación y 2FA'])


class Credentials(BaseModel):
    api_key: str = Field(min_length=1, max_length=4096)
    account_name: str = Field('NOC-Operator', pattern=r'^[a-zA-Z0-9._@-]{1,64}$')


class Verify(Credentials):
    totp_code: str = Field(pattern=r'^\d{6}$')


@router.get('/status')
def status():
    return {'success': True, 'mode': '2FA_TOTP' if settings.ENABLE_2FA else 'API_KEY', '2fa_enabled': settings.ENABLE_2FA,
            'session_expire_hours': settings.SESSION_EXPIRE_HOURS}


def operator(body):
    principal = key_principal(body.api_key)
    if not principal or principal.dashboard:
        raise InventoryError(401, 'Credencial de operador no válida.')
    return principal


@router.post('/setup-2fa')
def setup(body: Credentials):
    if not settings.ENABLE_2FA or not settings.ALLOW_2FA_ENROLLMENT:
        raise InventoryError(403, 'Enrolamiento 2FA deshabilitado.')
    operator(body)
    secret = get_totp_secret_for_account(body.api_key, body.account_name)
    return {'success': True, 'secret': secret, 'otpauth_uri': get_totp_uri(secret, body.account_name), 'issuer': 'SGRS-Inventarios'}


@router.post('/verify-2fa')
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
    token: str = Field(max_length=4096)


@router.post('/verify-token')
def verify_token(body: Token):
    payload = decode_jwt_session(body.token) if settings.ENABLE_2FA else None
    if not payload:
        raise InventoryError(401, 'Sesión no válida.')
    return {'success': True, 'data': payload}
