import asyncio
from unittest.mock import AsyncMock, Mock
import pytest
from app.clients.fortios import FortiOSClient
from app.core.errors import FortiOSConnectionError, FortiOSResponseError
from app.routers.traffic import get_active_traffic_sessions


def test_http_failure_without_provider_error_field_is_rejected():
    client = FortiOSClient()
    response = Mock(status_code=500)
    response.json.return_value = {"results": []}
    client.get_client = AsyncMock(return_value=Mock(request=AsyncMock(return_value=response)))
    with pytest.raises(FortiOSResponseError):
        asyncio.run(client.request("GET", "/api/v2/test"))


def test_all_log_sources_failed_is_not_empty_success():
    client = FortiOSClient()
    client.request = AsyncMock(side_effect=FortiOSConnectionError("unavailable"))
    with pytest.raises(FortiOSConnectionError):
        asyncio.run(client.get_traffic_logs())


def test_valid_empty_log_source_remains_empty():
    client = FortiOSClient()
    client.request = AsyncMock(return_value={"results": []})
    assert asyncio.run(client.get_traffic_logs()) == {"results": []}


def test_session_limit_is_enforced_after_provider_ignores_count(monkeypatch):
    from app.routers import traffic
    monkeypatch.setattr(traffic.fortios_client, "get_active_sessions", AsyncMock(return_value={"results": [{"srcip": "192.0.2.1", "dstip": "192.0.2.2"}] * 20}))
    result = asyncio.run(get_active_traffic_sessions(src_ip=None, dst_ip=None, dst_port=None, limit=5, vdom=None))
    assert len(result.data) == 5
