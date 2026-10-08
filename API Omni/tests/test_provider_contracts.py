from unittest.mock import Mock
import asyncio
from importlib import import_module
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from app.services.omnivista_service import OmniVistaService
from app.services.omnivista_service import omnivista_service
from app.config import settings
from app.dependencies import verify_api_key
from app.errors import OmniVistaAuthError, OmniVistaResponseError
from app.routers.catalogs import get_vlans
from app.main import app

omnivista_module = import_module("app.services.omnivista_service")


@pytest.mark.parametrize("operation", ["get_vlans", "get_topology", "get_notifications", "get_system_version", "get_devices"])
@pytest.mark.parametrize("http", [200, 404, 500])
def test_unavailable_is_not_an_empty_collection(operation, http):
    service = OmniVistaService()
    response = Mock(status_code=http)
    response.json.side_effect = ValueError("HTML page")
    service.request = Mock(return_value=response)
    with pytest.raises(OmniVistaResponseError):
        getattr(service, operation)()


def test_vlan_response_matches_declared_catalog():
    service = Mock()
    service.get_vlans.return_value = [{"vlanId": 10, "vlanName": "Test"}]
    response = get_vlans(service)
    assert response.data.total == 1
    assert response.data.vlans[0]["vlanId"] == 10


def test_omnivista_login_is_required_even_with_legacy_provider_key(monkeypatch):
    """La API upstream solo acepta la sesión obtenida con usuario y contraseña."""
    session = Mock()
    session.headers = {}
    login_response = Mock(status_code=200)
    login_response.json.return_value = {"accessToken": "session-token", "expiresIn": 300}
    query_response = Mock(status_code=200)
    session.post.return_value = login_response
    session.request.return_value = query_response

    monkeypatch.setattr(omnivista_module.requests, "Session", lambda: session)
    monkeypatch.setattr(settings, "OV_USERNAME", "api-readonly-user")
    monkeypatch.setattr(settings, "OV_PASSWORD", "test-password")
    monkeypatch.setattr(settings, "OV_API_KEY", "legacy-provider-key")

    service = OmniVistaService()
    response = service.request("GET", "/api/devices")

    assert response is query_response
    session.post.assert_called_once()
    assert session.post.call_args.kwargs["json"] == {
        "userName": "api-readonly-user",
        "password": "test-password",
    }
    assert session.headers["Authorization"] == "Bearer session-token"
    assert "legacy-provider-key" not in session.headers["Authorization"]


def test_omnivista_startup_rejects_failed_provider_login(monkeypatch):
    """El servicio no queda listo si OmniVista no autentica al arrancar."""
    monkeypatch.setattr(omnivista_service, "login", lambda: False)

    async def run_lifespan():
        with pytest.raises(RuntimeError, match="no autenticó"):
            async with app.router.lifespan_context(app):
                pass

    asyncio.run(run_lifespan())


@pytest.mark.parametrize("http_status", [401, 403, 404, 500])
def test_login_rejection_reports_only_http_status_without_credentials(monkeypatch, http_status):
    monkeypatch.setattr(settings, "OV_USERNAME", "test-api-user")
    monkeypatch.setattr(settings, "OV_PASSWORD", "secret-test-password")
    service = OmniVistaService()
    service.session.post = Mock(return_value=Mock(status_code=http_status))
    assert service.login() is False
    assert f"HTTP {http_status}" in service.last_login_error
    assert "secret-test-password" not in service.last_login_error
    assert service.access_token is None
    assert "Authorization" not in service.session.headers


def test_login_without_token_reports_invalid_provider_response(monkeypatch):
    monkeypatch.setattr(settings, "OV_USERNAME", "test-api-user")
    monkeypatch.setattr(settings, "OV_PASSWORD", "secret-test-password")
    service = OmniVistaService()
    response = Mock(status_code=200)
    response.json.return_value = {"success": False}
    service.session.post = Mock(return_value=response)
    assert service.login() is False
    assert "sin token" in service.last_login_error


def test_rejected_credentials_never_query_provider_or_use_legacy_key(monkeypatch):
    monkeypatch.setattr(settings, "OV_USERNAME", "test-api-user")
    monkeypatch.setattr(settings, "OV_PASSWORD", "secret-test-password")
    monkeypatch.setattr(settings, "OV_API_KEY", "legacy-provider-key")
    service = OmniVistaService()
    service.session.post = Mock(return_value=Mock(status_code=401))
    service.session.request = Mock()
    with pytest.raises(OmniVistaAuthError):
        service.request("GET", "/api/devices")
    service.session.request.assert_not_called()


def test_missing_app_key_fails_closed(monkeypatch):
    """Sin APP_API_KEY, las consultas no deben quedar abiertas en development."""
    monkeypatch.setattr(settings, "APP_API_KEY", None)
    monkeypatch.setattr(settings, "API_SECRET_KEY_CONFIG", None)
    monkeypatch.setattr(settings, "ALLOW_UNAUTHENTICATED", False)

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/catalogs/device-options",
        "raw_path": b"/api/v1/catalogs/device-options",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "scheme": "http",
    })

    with pytest.raises(HTTPException) as error:
        verify_api_key(request)

    assert error.value.status_code == 503


@pytest.mark.parametrize("operation,field", [("get_employee_accounts", "username"), ("get_company_properties", "deviceMac")])
def test_second_page_fetches_sufficient_prefix_without_inventing_total(operation, field):
    service = OmniVistaService()
    response = Mock(status_code=200)
    response.json.return_value = {"data": [{field: str(index)} for index in range(11)]}
    service.request = Mock(return_value=response)
    result = getattr(service, operation)(page=2, page_size=5)
    assert service.request.call_args.kwargs["json"]["querySize"] == 11
    assert [row[field] for row in result["items"]] == [str(index) for index in range(5, 10)]
    assert result["total"] is None and result["complete"] is False
    assert result["has_more"] is True and result["returned_count"] == 5
