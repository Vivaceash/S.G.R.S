"""Offline coverage for the new local boundary; no servers or hardware required.

Added for later verification. Not executed as part of the requested implementation.
"""
import pytest

import dashboard_access as access


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path / "private")
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.delenv("FORTI_API_KEY", raising=False)
    monkeypatch.delenv("FORTI_API_URL", raising=False)
    return access.save_user({"username": "root.local", "name": "Responsable local", "role": "super-admin", "password": "Ejemplo-local-2026"}, bootstrap=True)


def test_bootstrap_is_one_time_and_has_no_plaintext_password(local_store):
    assert "password_hash" not in local_store
    with pytest.raises(access.AccessError) as error:
        access.save_user({"username": "otro.root", "name": "Otra cuenta", "role": "super-admin", "password": "Ejemplo-local-2026"}, bootstrap=True)
    assert error.value.status == 409
    with access.database() as db:
        hashed = db.execute("SELECT password_hash FROM users").fetchone()[0]
    assert hashed.startswith("scrypt$")
    assert access.verify_password("Ejemplo-local-2026", hashed)
    assert not access.verify_password("incorrecta", hashed)


def test_ordinary_admin_cannot_create_users(local_store):
    admin = access.save_user({"username": "admin.local", "name": "Operador local", "role": "admin", "password": "Ejemplo-local-2026"}, local_store["id"])
    with pytest.raises(access.AccessError) as error:
        access.save_user({"username": "viewer.local", "name": "Consulta local", "role": "viewer", "password": "Ejemplo-local-2026"}, admin["id"])
    assert error.value.status == 403


def test_role_change_revokes_session(local_store):
    user = access.save_user({"username": "admin.local", "name": "Operador local", "role": "admin", "password": "Ejemplo-local-2026"}, local_store["id"])
    token, identity = access.login({"username": "admin.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    assert "inventory.write" in identity["capabilities"]
    assert access.session(f"sgrs_session={token}")
    access.save_user({**user, "role": "viewer", "active": True}, local_store["id"])
    assert access.session(f"sgrs_session={token}") is None


def test_own_role_change_and_stale_writes_are_denied(local_store):
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "active": True, "role": "viewer"}, local_store["id"])
    assert error.value.status == 409
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "active": True, "version": 0}, local_store["id"])
    assert error.value.status == 409


def test_connection_never_returns_secret_and_rejects_secret_reuse_at_new_url(local_store):
    payload = {"url": "http://127.0.0.1:8001/api/v1", "auth_mode": "api-key", "username": "", "secret": "clave-de-prueba", "version": 0}
    saved = access.save_connection("forti", payload, local_store["id"])
    assert saved["has_secret"]
    assert "secret" not in saved
    assert "secret" not in access.connection("forti", public=True)
    with pytest.raises(access.AccessError) as error:
        access.connection_values("forti", {**payload, "url": "https://otro.example/api/v1", "secret": ""})
    assert error.value.status == 422


@pytest.mark.parametrize("url", ["file:///etc/passwd", "http://169.254.169.254/api/v1", "https://usuario:clave@example.com", "https://example.com/api/v1?token=secret", "http://192.168.1.20/api/v1"])
def test_invalid_destinations_are_rejected_without_network(local_store, url):
    with pytest.raises(access.AccessError):
        access.connection_values("forti", {"url": url, "secret": "clave", "auth_mode": "api-key"})


def test_fixed_capabilities_and_no_session_for_missing_cookie(local_store):
    assert "inventory.write" not in access.capabilities("viewer")
    assert "users.manage" not in access.capabilities("admin")
    assert "integrations.manage" in access.capabilities("super-admin")
    assert access.session("") is None


@pytest.mark.parametrize("role", ["viewer", "admin"])
def test_business_sessions_do_not_disclose_internal_role(local_store, role):
    import json
    access.save_user({"username": "business.local", "name": "Cuenta operativa", "role": role,
                      "password": "Ejemplo-local-2026"}, local_store["id"])
    token, identity = access.login({"username": "business.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    for payload in (identity, access.session(f"sgrs_session={token}")):
        assert [item["id"] for item in payload["roles"]] == ["viewer", "admin"]
        assert "super" not in json.dumps(payload).lower()
        assert "traffic.read" not in payload["capabilities"]
        assert "users.manage" not in payload["capabilities"]


def test_internal_catalog_retains_all_roles():
    assert [r["id"] for r in access.visible_roles("super-admin")] == list(access.ROLES)
    assert access.visible_roles("unknown") == []


@pytest.mark.parametrize("path", [
    "/api/forti/firewall/policies", "/api/omni/employees/user@example.com",
    "/api/forti/traffic/ip/192.0.2.1", "/api/traffic/ip/2001:db8::1",
    "/api/omni/monitoring/topology",
])
def test_explicit_proxy_read_catalog(path):
    from dashboard_routes import reserved_read_allowed
    assert reserved_read_allowed(path)


@pytest.mark.parametrize("path", [
    "/api/forti/auth/status", "/api/omni/auth/setup-2fa", "/api/forti/new-route",
    "/api/omni/monitoring/../auth/status", "/api/forti/devices/%2e%2e",
    "/api/omni/openapi.json", "/api/forti/firewall/policies/extra",
])
def test_unknown_or_authentication_proxy_paths_are_denied(path):
    from dashboard_routes import reserved_read_allowed
    assert not reserved_read_allowed(path)


@pytest.mark.parametrize("role", ["viewer", "admin"])
@pytest.mark.parametrize("path", [
    "/api/admin/users", "/api/admin/connections", "/api/admin/catalog", "/api/admin/history", "/api/forti/firewall/policies",
    "/api/traffic/ip/192.0.2.1", "/api/omni/employees",
])
def test_business_read_denials_do_not_disclose_internal_role(role, path):
    import json
    from dashboard_routes import AccessRoutes

    class Boundary(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            self.identity = {"user": {"role": role}, "capabilities": access.capabilities(role)}

        def _send_json(self, payload, status=200):
            self.response = (status, payload)

    handler = Boundary()
    handler.path = path
    assert handler.access_get() is True
    code, payload = handler.response
    assert code == 403
    assert "super" not in json.dumps(payload).lower()
