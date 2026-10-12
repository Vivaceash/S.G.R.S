import pytest
import httpx
from unittest.mock import AsyncMock, Mock
from app.main import app
from app.core.config import settings
from app.core.config import Settings
from app.clients.fortios import FortiOSClient
from app.core.errors import FortiOSAuthError
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


def test_production_requires_fortios_provider_token():
    """La API no puede declararse lista sin la credencial separada de FortiOS."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="FORTIOS_API_TOKEN"):
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            DEBUG=False,
            APP_API_KEY="a" * 32,
            FORTIOS_API_TOKEN="",
            FORTIOS_VERIFY_SSL=True,
            JWT_SECRET_KEY="a-production-jwt-secret-with-more-than-32-bytes",
            ALLOWED_HOSTS=["api.example.test"],
            CORS_ORIGINS=["https://dashboard.example.test"],
        )


@pytest.mark.anyio
async def test_missing_app_key_fails_closed(monkeypatch):
    """Sin APP_API_KEY configurada, una consulta nunca debe quedar abierta."""
    monkeypatch.setattr(settings, "APP_API_KEY", None)
    monkeypatch.setattr(settings, "API_SECRET_KEY", None)
    monkeypatch.setattr(settings, "ALLOW_UNAUTHENTICATED", False)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/devices")

    assert response.status_code == 503


def _production_settings(**overrides):
    values = {
        "_env_file": None,
        "ENVIRONMENT": "production",
        "DEBUG": False,
        "APP_API_KEY": "test-gateway-query-key-with-more-than-16-chars",
        "FORTIOS_API_TOKEN": "test-fortios-provider-token",
        "JWT_SECRET_KEY": "test-signing-secret-with-more-than-32-bytes",
        "FORTIOS_SCHEME": "https",
        "FORTIOS_VERIFY_SSL": True,
        "FORTIOS_CA_BUNDLE": None,
        "FORTIOS_ALLOW_UNVERIFIED_TLS": False,
        "ALLOWED_HOSTS": ["api.example.test"],
        "CORS_ORIGINS": ["https://dashboard.example.test"],
    }
    values.update(overrides)
    return Settings(**values)


def test_production_requires_explicit_unverified_tls_override():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="FORTIOS_ALLOW_UNVERIFIED_TLS"):
        _production_settings(FORTIOS_VERIFY_SSL=False)


def test_production_accepts_explicit_unverified_https():
    value = _production_settings(FORTIOS_VERIFY_SSL=False, FORTIOS_ALLOW_UNVERIFIED_TLS=True)
    assert value.FORTIOS_VERIFY_SSL is False
    assert value.FORTIOS_ALLOW_UNVERIFIED_TLS is True


@pytest.mark.parametrize("overrides,field", [
    ({"FORTIOS_SCHEME": "http", "FORTIOS_VERIFY_SSL": False}, "FORTIOS_SCHEME"),
    ({"FORTIOS_VERIFY_SSL": True}, "FORTIOS_ALLOW_UNVERIFIED_TLS"),
])
def test_unverified_tls_override_keeps_https_and_requires_disabled_verification(overrides, field):
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match=field):
        _production_settings(FORTIOS_ALLOW_UNVERIFIED_TLS=True, **overrides)


@pytest.mark.anyio
async def test_fortios_client_requires_provider_token(monkeypatch):
    """El token de FortiOS es independiente de APP_API_KEY y debe existir antes de consultar."""
    monkeypatch.setattr(settings, "FORTIOS_API_TOKEN", "")
    client = FortiOSClient()

    with pytest.raises(FortiOSAuthError, match="FORTIOS_API_TOKEN"):
        await client.request("GET", "api/v2/monitor/system/status")


@pytest.mark.anyio
async def test_fortios_client_forwards_only_provider_token(monkeypatch):
    """APP_API_KEY autentica al gateway; FORTIOS_API_TOKEN autentica al appliance."""
    monkeypatch.setattr(settings, "APP_API_KEY", "gateway-query-key")
    monkeypatch.setattr(settings, "FORTIOS_API_TOKEN", "fortios-provider-token")

    upstream_response = Mock(status_code=200)
    upstream_response.json.return_value = {"status": "success", "results": []}
    upstream = Mock(is_closed=False)
    upstream.request = AsyncMock(return_value=upstream_response)
    async_client_factory = Mock(return_value=upstream)
    monkeypatch.setattr("app.clients.fortios.httpx.AsyncClient", async_client_factory)

    client = FortiOSClient()
    await client.request("GET", "api/v2/monitor/system/status")

    headers = async_client_factory.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer fortios-provider-token"
    assert "gateway-query-key" not in headers["Authorization"]


@pytest.mark.anyio
async def test_fortios_startup_checks_provider_authentication(monkeypatch):
    """El lifespan valida FortiOS antes de publicar la aplicación."""
    calls = 0

    async def fake_status():
        nonlocal calls
        calls += 1
        return {"status": "success"}

    monkeypatch.setattr("app.main.fortios_client.get_system_status", fake_status)

    async with app.router.lifespan_context(app):
        pass

    assert calls == 1


@pytest.mark.anyio
async def test_fortios_startup_rejects_provider_authentication_failure(monkeypatch):
    """El modo estricto conserva el fail-fast opcional para instalaciones que lo exijan."""
    async def failed_status():
        raise FortiOSAuthError("token de prueba rechazado")

    monkeypatch.setattr("app.main.fortios_client.get_system_status", failed_status)
    monkeypatch.setattr(settings, "REQUIRE_PROVIDER_ON_STARTUP", True)

    with pytest.raises(RuntimeError, match="no está autenticado"):
        async with app.router.lifespan_context(app):
            pass


@pytest.mark.anyio
async def test_fortios_startup_keeps_local_api_when_provider_is_degraded(monkeypatch):
    """Sin modo estricto, el liveness local no depende de la disponibilidad upstream."""
    async def failed_status():
        raise FortiOSAuthError("token de prueba rechazado")

    monkeypatch.setattr("app.main.fortios_client.get_system_status", failed_status)
    monkeypatch.setattr(settings, "REQUIRE_PROVIDER_ON_STARTUP", False)

    async with app.router.lifespan_context(app):
        pass


@pytest.mark.anyio
async def test_unauthenticated_request_rejected():
    """1. Rechazo de petición sin cabecera de autenticación (401)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/devices")
        assert r.status_code == 401


@pytest.mark.anyio
async def test_public_health_and_authenticated_dhcp_pool(monkeypatch):
    """Salud pública; DHCP requiere clave, al igual que las demás consultas."""
    transport = httpx.ASGITransport(app=app)
    async def fake_status():
        return {"results": {"hostname": "test", "version": "test", "serial": "ABCDEF123456"}}
    async def fake_request(*args, **kwargs):
        return {"results": [], "vdom": "root"}
    async def fake_leases(*args, **kwargs):
        return {"results": [], "vdom": "root"}
    monkeypatch.setattr("app.routers.health.fortios_client.get_system_status", fake_status)
    monkeypatch.setattr("app.routers.network.fortios_client.request", fake_request)
    monkeypatch.setattr("app.routers.network.fortios_client.get_dhcp_leases", fake_leases)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r_health = await client.get("/api/v1/health")
        assert r_health.status_code == 401
        assert (await client.get("/api/v1/health", headers={"X-API-Key": VALID_KEY})).status_code == 200

        r_pools = await client.get("/api/v1/network/dhcp-pools")
        assert r_pools.status_code == 401
        assert (await client.get("/api/v1/network/dhcp-pools", headers={"X-API-Key": VALID_KEY})).status_code == 200
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
