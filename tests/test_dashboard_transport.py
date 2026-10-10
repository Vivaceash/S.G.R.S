"""Transport boundary proof without network or production credentials."""
from email.message import Message
from io import BytesIO

import pytest
import json
from types import SimpleNamespace

from dashboard_access import AccessError
from dashboard_routes import AccessRoutes


@pytest.mark.parametrize('server_ip,client_ip', [('10.20.0.250', '10.30.1.20'),
                                               ('172.20.0.250', '172.21.1.20'),
                                               ('192.168.38.250', '192.168.99.20'),
                                               ('11.20.1.250', '11.20.1.20')])
def test_all_server_lan_interfaces_allow_same_origin_sessions(monkeypatch, server_ip, client_ip):
    addresses = [{'addr_info': [{'family': 'inet', 'scope': 'global', 'local': ip, 'prefixlen': 24}]}
                 for ip in ('10.20.0.250', '172.20.0.250', '192.168.38.250', '11.20.1.250')]
    monkeypatch.setattr('dashboard_routes.subprocess.run',
                        lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps(addresses)))
    route = handler(monkeypatch, peer=client_ip, host=server_ip + ':3000',
                    origin='http://' + server_ip + ':3000')
    route._boundary(mutation=True)


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


def test_configured_institutional_cidr_can_use_lan_http(monkeypatch):
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000")
    monkeypatch.setenv("SGRS_LAN_CLIENT_CIDRS", "15.40.0.0/16")
    route = handler(monkeypatch, peer="15.40.1.57", host="192.168.38.250:3000",
                    origin="http://192.168.38.250:3000", path="/api/auth/session")
    route._boundary(mutation=False)


@pytest.mark.parametrize('peer', ['15.40.0.1', '15.40.1.57', '15.40.255.254'])
def test_any_15_40_client_can_open_current_qr_host(monkeypatch, peer):
    monkeypatch.setenv('SGRS_LAN_ORIGIN', 'http://15.40.1.10:3000')
    monkeypatch.setenv('SGRS_LAN_CLIENT_CIDRS', '15.40.0.0/16')
    route = handler(monkeypatch, peer=peer, host='15.40.1.10:3000',
                    origin='http://15.40.1.10:3000', path='/api/auth/login')
    route._boundary(mutation=True)


@pytest.mark.parametrize('peer', ['15.39.255.254', '15.41.0.1'])
def test_adjacent_networks_are_not_covered_by_15_40_rule(monkeypatch, peer):
    monkeypatch.setenv('SGRS_LAN_ORIGIN', 'http://15.40.1.10:3000')
    monkeypatch.setenv('SGRS_LAN_CLIENT_CIDRS', '15.40.0.0/16')
    route = handler(monkeypatch, peer=peer, host='15.40.1.10:3000',
                    origin='http://15.40.1.10:3000', path='/api/auth/login')
    with pytest.raises(AccessError, match='HTTPS'):
        route._boundary(mutation=True)


def test_unconfigured_public_client_remains_rejected(monkeypatch):
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000")
    monkeypatch.setenv("SGRS_LAN_CLIENT_CIDRS", "15.40.0.0/16")
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
