import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import HTTPException, status, Security, Request
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings
from app.services.omnivista_service import omnivista_service, OmniVistaService
from app.security.logging import log_security_event

api_key_header = APIKeyHeader(name="X-API-KEY", auto_error=False, description="Clave de API enviada en cabecera X-API-KEY")
api_key_header_lower = APIKeyHeader(name="X-API-Key", auto_error=False, description="Clave de API enviada en cabecera X-API-Key")
bearer_auth = HTTPBearer(auto_error=False, description="Token Bearer de autenticación")
JWT_ISSUER = "SGRS-OmniVista-Gateway"
JWT_AUDIENCE = "sgrs-omnivista-api"


# =============================================================================
# Utilidades Criptográficas para Autenticación en Dos Pasos (2FA / TOTP RFC 6238)
# =============================================================================

def generate_totp_secret() -> str:
    """Genera un secreto Base32 de 160 bits para enrolar en Google Authenticator o Microsoft Authenticator."""
    random_bytes = secrets.token_bytes(20)
    return base64.b32encode(random_bytes).decode("utf-8").replace("=", "")


def get_totp_secret_for_account(api_key: str, account_name: str = "NOC-Operator") -> str:
    """Returns an explicitly provisioned independent TOTP secret."""
    if not settings.TOTP_SECRET_KEY:
        raise ValueError("TOTP_SECRET_KEY is not provisioned")
    digest = hmac.new(settings.TOTP_SECRET_KEY.encode("utf-8"),
                       f"sgrs-totp:v1:{account_name}".encode("utf-8"), hashlib.sha256).digest()[:20]
    return base64.b32encode(digest).decode("ascii").rstrip("=")



def get_totp_token(secret: str, interval: int = 30, digits: int = 6, for_time: Optional[float] = None) -> str:
    """Genera el código numérico TOTP para el timestamp indicado bajo el estándar RFC 6238."""
    if for_time is None:
        for_time = time.time()

    clean_secret = secret.strip().upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)

    try:
        key = base64.b32decode(clean_secret, casefold=True)
    except Exception:
        return "000000"

    counter = int(for_time // interval)
    msg = struct.pack(">Q", counter)
    hmac_hash = hmac.new(key, msg, hashlib.sha1).digest()
    offset = hmac_hash[-1] & 0x0F
    code = ((struct.unpack(">I", hmac_hash[offset : offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits))
    return str(code).zfill(digits)


def verify_totp_code(secret: str, code: str, window: int = 1, interval: int = 30) -> bool:
    """Valida un código TOTP de 6 dígitos con ventana de tolerancia de deriva de reloj (±1 ciclo = ±30s)."""
    if not secret or not code:
        return False

    clean_code = str(code).strip()
    if not clean_code.isdigit() or len(clean_code) != 6:
        return False

    now = time.time()
    for w in range(-window, window + 1):
        test_time = now + (w * interval)
        expected = get_totp_token(secret, interval=interval, for_time=test_time)
        if secrets.compare_digest(expected, clean_code):
            return True
    return False


def get_totp_uri(secret: str, account_name: str = "NOC-Operator", issuer: str = "SGRS-OmniVista") -> str:
    """Genera la URI otpauth:// estándar para generar códigos QR de enrolamiento."""
    return f"otpauth://totp/{quote(issuer)}:{quote(account_name)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"


# =============================================================================
# Utilidades de Tokens de Sesión JWT (RFC 7519)
# =============================================================================

def _b64_url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64_url_decode(data_str: str) -> bytes:
    padding = len(data_str) % 4
    if padding:
        data_str += "=" * (4 - padding)
    return base64.urlsafe_b64decode(data_str.encode("utf-8"))


def create_jwt_session(subject: str, is_2fa_verified: bool = True, expires_hours: Optional[int] = None) -> str:
    """Genera un token JWT (HS256) firmado criptográficamente para sesiones de operador verificadas."""
    exp_h = expires_hours or settings.SESSION_EXPIRE_HOURS
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": subject,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "nbf": now,
        "exp": now + (exp_h * 3600),
        "2fa_verified": is_2fa_verified,
    }

    header_b64 = _b64_url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64_url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature_base = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), signature_base, hashlib.sha256).digest()
    sig_b64 = _b64_url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_jwt_session(token: str) -> Optional[Dict[str, Any]]:
    """Valida firma criptográfica, expiración y claims de un token JWT de sesión."""
    parts = token.split(".")
    if len(parts) != 3:
        return None

    header_b64, payload_b64, sig_b64 = parts

    try:
        header = json.loads(_b64_url_decode(header_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(header, dict) or header.get("alg") != "HS256" or header.get("typ") != "JWT":
        return None

    signature_base = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected_sig = hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), signature_base, hashlib.sha256).digest()
    expected_sig_b64 = _b64_url_encode(expected_sig)

    if not secrets.compare_digest(sig_b64, expected_sig_b64):
        return None

    try:
        payload_bytes = _b64_url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None

    required_claims = {"sub", "iss", "aud", "jti", "iat", "nbf", "exp", "2fa_verified"}
    if not required_claims.issubset(payload):
        return None
    if payload.get("iss") != JWT_ISSUER or payload.get("aud") != JWT_AUDIENCE:
        return None
    if not isinstance(payload.get("sub"), str) or not payload["sub"].strip():
        return None
    if not isinstance(payload.get("jti"), str) or not payload["jti"].strip():
        return None
    if payload.get("2fa_verified") is not True:
        return None

    for claim in ("iat", "nbf", "exp"):
        if not isinstance(payload.get(claim), int) or isinstance(payload.get(claim), bool):
            return None

    now = int(time.time())
    clock_skew = 30
    if now >= payload["exp"]:
        return None
    if payload["nbf"] > now + clock_skew or payload["iat"] > now + clock_skew:
        return None
    if payload["exp"] <= payload["iat"]:
        return None
    if payload["exp"] - payload["iat"] > (settings.SESSION_EXPIRE_HOURS * 3600) + clock_skew:
        return None

    return payload


# =============================================================================
# Inyector de Dependencia de Autenticación
# =============================================================================

def verify_api_key(
    request: Request,
    x_api_key: Optional[str] = Security(api_key_header),
    x_api_key_alt: Optional[str] = Security(api_key_header_lower),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth),
) -> bool:
    """
    Valida de forma segura y en tiempo constante que la petición cuente con:
    1. Un token JWT con 2FA verificado.
    2. O una clave de API válida configurada en APP_API_KEY / API_SECRET_KEY.
    """
    # Solo liveness mínimo es público; el resto de la API conserva autenticación.
    if request.method == "GET" and request.url.path in {
        "/health", "/api/v1/health", "/api/v1/system/health"
    }:
        return True

    # Solo permitir el bypass en pruebas automatizadas; nunca en un proceso desplegado.
    if settings.ALLOW_UNAUTHENTICATED and settings.ENVIRONMENT.strip().lower() == "test":
        return True

    client_ip = request.client.host if request.client else "unknown"
    req_id = getattr(request.state, "request_id", "N/A")

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

    # 1. Intentar validar si es un token de sesión JWT con 2FA verificado
    jwt_payload = decode_jwt_session(token_clean) if settings.ENABLE_2FA else None
    if jwt_payload and jwt_payload.get("2fa_verified"):
        return True

    # 2. Si 2FA está activado y se envía solo la API Key sin sesión 2FA
    if settings.ENABLE_2FA:
        log_security_event(
            "auth_2fa_required",
            {"ip": client_ip, "path": request.url.path, "req_id": req_id},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Autenticación en dos pasos (2FA) obligatoria. Inicie sesión vía /api/v1/auth/verify-2fa.",
        )

    # 3. Comparación segura en tiempo constante contra todas las claves válidas
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
            detail="Clave de API no válida. Usa APP_API_KEY de esta API en X-API-Key; no la credencial de OmniVista ni la contraseña del dashboard.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True


def get_ov_service() -> OmniVistaService:
    """Inyector del servicio OmniVista"""
    return omnivista_service
