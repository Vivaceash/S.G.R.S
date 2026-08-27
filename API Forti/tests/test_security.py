import pytest
import httpx
from app.main import app
from app.core.config import settings
from app.security.sanitizer import sanitize_data

VALID_KEY = settings.api_keys[0] if settings.api_keys else "admin"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_unauthenticated_request_rejected():
    """1. Rechazo de petición sin cabecera de autenticación (401)"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/devices")
        assert r.status_code == 401


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
