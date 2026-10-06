"""Transport boundary proof without network or production credentials."""
from email.message import Message
from io import BytesIO

import pytest

from dashboard_access import AccessError
from dashboard_routes import AccessRoutes


def handler(monkeypatch, *, public="", peer="127.0.0.1", host="localhost:3000",
            origin="http://localhost:3000", proto=None, path="/api/auth/login"):
    monkeypatch.setenv("SGRS_PUBLIC_ORIGIN", public)
    route = AccessRoutes()
    route.client_address = (peer, 12345)
    route.path = path
    route.headers = Message()
    route.headers["Host"] = host
    if origin:
        route.headers["Origin"] = origin
    if proto:
        route.headers["X-Forwarded-Proto"] = proto
    route.headers["Content-Type"] = "application/json"
    route.headers["Content-Length"] = "2"
    route.rfile = BytesIO(b"{}")
    route._send_json = lambda payload, status=200: setattr(route, "response", (status, payload))
    return route


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/bootstrap", "/api/auth/session", "/api/admin/users/save", "/api/idfs"])
def test_lan_http_allowed_when_configured(monkeypatch, path):
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.0.2.20:3000")
    route = handler(monkeypatch, peer="192.0.2.10", host="192.0.2.20:3000",
                    origin="http://192.0.2.20:3000", path=path)
    handled = route.access_post() if path.endswith(("login", "bootstrap", "save")) else route.access_get()
    assert handled
    # No debe ser rechazado por la capa de transporte HTTPS
    if hasattr(route, "response"):
        error_msg = str(route.response[1].get("error", "")) if isinstance(route.response[1], dict) else ""
        assert "HTTPS" not in error_msg


def test_lan_http_session_and_cookie_without_secure(monkeypatch):
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000")
    route = handler(monkeypatch, peer="192.168.38.10", host="192.168.38.250:3000",
                    origin="http://192.168.38.250:3000", path="/api/auth/session")
    handled = route.access_get()
    assert handled
    assert route.response[0] == 200
    assert route.response[1].get("user") is None

    # Verificar que la cookie emitida para LAN HTTP no contenga '; Secure'
    route._cookie("lan-session-token")
    assert "; Secure" not in route._session_cookie
    assert "; HttpOnly" in route._session_cookie
    assert "; SameSite=Strict" in route._session_cookie


def test_public_ip_rejected_even_if_lan_origin_set(monkeypatch):
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000")
    route = handler(monkeypatch, peer="8.8.8.8", host="192.168.38.250:3000",
                    origin="http://192.168.38.250:3000", path="/api/auth/session")
    with pytest.raises(AccessError, match="HTTPS"):
        route._boundary(mutation=False)


@pytest.mark.parametrize("peer,proto", [("192.0.2.10", None), ("192.0.2.10", "https"), ("127.0.0.1", None), ("127.0.0.1", "http"), ("127.0.0.1", "https,http")])
def test_forged_https_origin_is_not_transport_evidence(monkeypatch, peer, proto):
    route = handler(monkeypatch, public="https://dashboard.example", host="dashboard.example",
                    origin="https://dashboard.example", peer=peer, proto=proto)
    with pytest.raises(AccessError, match="HTTPS"):
        route._boundary(mutation=True)


def test_trusted_https_proxy_and_secure_cookie(monkeypatch):
    route = handler(monkeypatch, public="https://dashboard.example", host="dashboard.example",
                    origin="https://dashboard.example", proto="https")
    route._boundary(mutation=True)
    route._cookie("test-token")
    assert "; Secure" in route._session_cookie
    assert "; HttpOnly" in route._session_cookie
    assert "; SameSite=Strict" in route._session_cookie


def test_local_development_stays_available(monkeypatch):
    route = handler(monkeypatch)
    route._boundary(mutation=True)
    route._cookie("test-token")
    assert "; Secure" not in route._session_cookie


def test_public_mode_disables_local_http_authentication(monkeypatch):
    route = handler(monkeypatch, public="https://dashboard.example")
    with pytest.raises(AccessError, match="HTTPS"):
        route._boundary(mutation=True)


def test_lan_proxy_cannot_spoof_local_development(monkeypatch):
    route = handler(monkeypatch, peer="192.0.2.10")
    with pytest.raises(AccessError, match="HTTPS"):
        route._boundary(mutation=True)


def test_existing_mobile_report_keeps_its_separate_transport(monkeypatch):
    route = handler(monkeypatch, peer="192.0.2.10", host="192.0.2.20:3000",
                    origin="http://192.0.2.20:3000", path="/api/mobile-report")
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.0.2.20:3000")
    route._boundary(mutation=True)
