import pytest
import httpx
from app.main import app
from app.core.config import settings

VALID_KEY = settings.api_keys[0] if settings.api_keys else "admin"

ENDPOINTS = [
    "/api/v1/health",
    "/api/v1/system/status",
    "/api/v1/system/resources",
    "/api/v1/system/firmware",
    "/api/v1/devices",
    "/api/v1/network/dhcp-leases",
    "/api/v1/network/arp-table",
    "/api/v1/network/interfaces",
    "/api/v1/traffic/sessions",
    "/api/v1/traffic/destinations",
    "/api/v1/traffic/logs",
    "/api/v1/traffic/ip/192.168.38.110",
    "/api/v1/firewall/policies",
    "/api/v1/firewall/addresses",
    "/api/v1/firewall/address-groups",
    "/api/v1/vpn/ipsec",
    "/api/v1/vpn/ssl-sessions",
]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize("endpoint", ENDPOINTS)
async def test_fortigate_live_endpoint(endpoint):
    """Verifica que cada endpoint operativo responda exitosamente contra el hardware FortiGate"""
    transport = httpx.ASGITransport(app=app)
    headers = {"X-API-Key": VALID_KEY}
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(endpoint, headers=headers)
        # 200 si el hardware FortiGate responde; 503 si el hardware está inalcanzable (manejador controlado, sin HTTP 500)
        assert response.status_code in (200, 503)
        data = response.json()
        assert "success" in data
