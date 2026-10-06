import pytest
import httpx
from app.main import app
from app.core.config import settings
from app.security.sanitizer import sanitize_data

VALID_KEY = settings.api_keys[0] if settings.api_keys else "admin"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_production_rejects_development_admin_key():
    """La comodidad local `admin` no puede llegar accidentalmente a producción."""
    from pydantic import ValidationError
    from app.core.config import Settings

    with pytest.raises(ValidationError, match="APP_API_KEY"):
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            DEBUG=False,
            APP_API_KEY="admin",
            JWT_SECRET_KEY="a-production-jwt-secret-with-more-than-32-bytes",
            FORTIOS_VERIFY_SSL=True,
            ALLOWED_HOSTS=["api.example.test"],
            CORS_ORIGINS=["https://dashboard.example.test"],
        )


@pytest.mark.anyio
async def test_unauthenticated_request_rejected():
    """1. Rechazo de petición sin cabecera de autenticación (401)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/devices")
        assert r.status_code == 401


@pytest.mark.anyio
async def test_diagnostics_require_auth_but_minimal_health_is_public():
    """Solo el liveness mínimo es público; los diagnósticos exigen credenciales."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r_health = await client.get("/api/v1/health")
        assert r_health.status_code == 401

        r_pools = await client.get("/api/v1/network/dhcp-pools")
        assert r_pools.status_code == 401
        r_leases = await client.get("/api/v1/network/dhcp-leases")
        assert r_leases.status_code == 401


@pytest.mark.anyio
async def test_invalid_api_key_rejected():
    """2. Rechazo de clave de API incorrecta (403)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/devices", headers={"X-API-Key": "clave_falsa_123"})
        assert r.status_code == 403


@pytest.mark.anyio
async def test_auth_with_x_api_key_header():
    """3. Autenticación exitosa con cabecera X-API-Key"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"X-API-Key": VALID_KEY})
        assert r.status_code == 200


@pytest.mark.anyio
async def test_auth_with_x_api_key_uppercase():
    """4. Autenticación exitosa con cabecera X-API-KEY"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"X-API-KEY": VALID_KEY})
        assert r.status_code == 200


@pytest.mark.anyio
async def test_auth_with_bearer_token():
    """5. Autenticación exitosa con Authorization: Bearer"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"Authorization": f"Bearer {VALID_KEY}"})
        assert r.status_code == 200


@pytest.mark.anyio
async def test_owasp_security_headers():
    """6. Verificación de cabeceras OWASP de seguridad"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"X-API-Key": VALID_KEY})
        headers = r.headers

        assert headers.get("X-Content-Type-Options") == "nosniff"
        assert headers.get("X-Frame-Options") == "DENY"
        assert headers.get("X-XSS-Protection") == "0"
        assert headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert "geolocation=()" in headers.get("Permissions-Policy", "")
        assert "no-store" in headers.get("Cache-Control", "")
        assert headers.get("Content-Security-Policy") == "default-src 'none'; frame-ancestors 'none'"
        assert bool(headers.get("X-Request-ID"))


@pytest.mark.anyio
async def test_rate_limiting_headers():
    """7. Presencia de cabeceras de Rate Limiting"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"X-API-Key": VALID_KEY})
        assert bool(r.headers.get("X-RateLimit-Limit"))
        assert bool(r.headers.get("X-RateLimit-Remaining"))


@pytest.mark.anyio
async def test_public_health_liveness_probe():
    """8. Endpoint público /health (liveness probe) sin filtrar datos internos"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "healthy"
        assert "serial" not in data
        assert "fortigate_connection" not in data


@pytest.mark.anyio
async def test_ip_and_serial_masking():
    """9. Enmascaramiento de IPs y serial en /api/v1/health"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health", headers={"X-API-Key": VALID_KEY})
        data = r.json().get("data", {})
        fg_conn = data.get("fortigate_connection", {})
        host_masked = fg_conn.get("configured_host", "")
        serial_masked = fg_conn.get("serial", "")
        assert "***" in host_masked or settings.FORTIOS_HOST not in host_masked
        if serial_masked:
            assert "****" in serial_masked


@pytest.mark.anyio
async def test_input_validation_src_ip_injection():
    """10. Bloqueo por validación de inyección en src_ip (422)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get(
            "/api/v1/traffic/logs?src_ip=192.168.1.1' OR '1'='1",
            headers={"X-API-Key": VALID_KEY}
        )
        assert r.status_code == 422


@pytest.mark.anyio
async def test_input_validation_vdom_injection():
    """11. Bloqueo por caracteres no válidos en parámetro vdom (422)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get(
            "/api/v1/firewall/policies?vdom=root;DROP_TABLE",
            headers={"X-API-Key": VALID_KEY}
        )
        assert r.status_code == 422


@pytest.mark.anyio
async def test_input_validation_firewall_action():
    """12. Bloqueo de valor no admitido en acción de firewall (422)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get(
            "/api/v1/firewall/policies?action=malicious_action",
            headers={"X-API-Key": VALID_KEY}
        )
        assert r.status_code == 422


def test_sensitive_data_sanitizer():
    """13. Sanitizador de datos sensibles y secretos (PSK, pass)"""
    dummy_data = {
        "name": "ipsec_tunnel_issste",
        "psksecret": "SuperSecretKey123!",
        "auth_password": "AdminPassword",
        "nested": {
            "private_key": "MIIEowIBAAKCAQEA0...",
            "status": "up",
        }
    }
    sanitized = sanitize_data(dummy_data)
    assert sanitized["psksecret"] == "******"
    assert sanitized["auth_password"] == "******"
    assert sanitized["nested"]["private_key"] == "******"


@pytest.mark.anyio
async def test_disallowed_http_methods_rejected():
    """14. Rechazo de POST en endpoint exclusivo de lectura (405 Method Not Allowed)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/devices", headers={"X-API-Key": VALID_KEY})
        assert r.status_code == 405


@pytest.mark.anyio
async def test_auth_status_endpoint():
    """15. Consulta del estado de autenticación y 2FA"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/auth/status")
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert "mode" in data
        assert "2fa_enabled" in data


@pytest.mark.anyio
async def test_2fa_setup_and_verification_flow(monkeypatch):
    """16. Flujo completo de enrolamiento 2FA (TOTP) y autenticación con sesión JWT"""
    from app.core.security import get_totp_token

    monkeypatch.setattr(settings, "ENABLE_2FA", True)
    monkeypatch.setattr(settings, "ALLOW_2FA_ENROLLMENT", True)
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "forti-test-jwt-secret-with-at-least-32-bytes")
    monkeypatch.setattr(settings, "TOTP_SECRET_KEY", "forti-test-dedicated-totp-master-key")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Setup 2FA con clave de API correcta
        r_setup = await client.post(
            "/api/v1/auth/setup-2fa",
            json={"api_key": VALID_KEY, "account_name": "TestOperator"},
        )
        assert r_setup.status_code == 200
        setup_data = r_setup.json()
        assert setup_data["success"] is True
        secret = setup_data["secret"]
        assert "otpauth://" in setup_data["otpauth_uri"]

        # 2. Generar código TOTP válido para el secreto
        totp_code = get_totp_token(secret)

        # 3. Verificar código y obtener token de sesión JWT
        r_verify = await client.post(
            "/api/v1/auth/verify-2fa",
            json={
                "api_key": VALID_KEY,
                "totp_code": totp_code,
                "account_name": "TestOperator",
            },
        )
        assert r_verify.status_code == 200
        verify_data = r_verify.json()
        assert verify_data["success"] is True
        access_token = verify_data["access_token"]
        assert len(access_token.split(".")) == 3

        # 4. Consumir endpoint protegido usando el token Bearer emitido
        r_query = await client.get(
            "/api/v1/health",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert r_query.status_code == 200

        # 5. Rechazar código TOTP falso
        r_bad_totp = await client.post(
            "/api/v1/auth/verify-2fa",
            json={
                "api_key": VALID_KEY,
                "totp_code": "000000",
                "account_name": "TestOperator",
            },
        )
        assert r_bad_totp.status_code == 401


def test_legacy_or_incomplete_jwt_is_rejected():
    """Un JWT firmado pero sin claims obligatorios nunca debe autenticar."""
    import base64
    import hashlib
    import hmac
    import json
    from app.core.security import decode_jwt_session

    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    header = encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = encode(json.dumps({"2fa_verified": True}).encode())
    signature = encode(hmac.new(settings.JWT_SECRET_KEY.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())

    assert decode_jwt_session(f"{header}.{payload}.{signature}") is None


@pytest.mark.anyio
async def test_jwt_is_not_accepted_when_2fa_is_disabled():
    from app.core.security import create_jwt_session

    token = create_jwt_session("TestOperator")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/devices", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
