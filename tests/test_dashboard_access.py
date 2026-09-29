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


@pytest.mark.parametrize("role,expected_roles", [("viewer", []), ("soporte", []), ("admin", ["soporte", "admin"])])
def test_business_sessions_do_not_disclose_internal_role(local_store, role, expected_roles):
    import json
    access.save_user({"username": f"business.{role}", "name": "Cuenta operativa", "role": role,
                      "password": "Ejemplo-local-2026"}, local_store["id"])
    token, identity = access.login({"username": f"business.{role}", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    for payload in (identity, access.session(f"sgrs_session={token}")):
        assert [item["id"] for item in payload["roles"]] == expected_roles
        assert "super" not in json.dumps(payload).lower()
        assert "traffic.read" not in payload["capabilities"]
        assert "users.manage" not in payload["capabilities"]


def test_internal_catalog_retains_all_roles():
    assert [r["id"] for r in access.visible_roles("super-admin")] == ["soporte", "admin", "super-admin"]
    assert [r["id"] for r in access.visible_roles("admin")] == ["soporte", "admin"]
    assert access.visible_roles("unknown") == []
    assert access.visible_roles("viewer") == []
    assert access.visible_roles("soporte") == []


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


@pytest.mark.parametrize("role,path", [
    ("viewer", "/api/admin/users"),
    ("soporte", "/api/admin/users"),
    ("viewer", "/api/admin/connections"),
    ("admin", "/api/admin/connections"),
    ("viewer", "/api/admin/catalog"),
    ("admin", "/api/admin/catalog"),
    ("viewer", "/api/admin/history"),
    ("admin", "/api/admin/history"),
    ("viewer", "/api/forti/firewall/policies"),
    ("admin", "/api/forti/firewall/policies"),
    ("viewer", "/api/traffic/ip/192.0.2.1"),
    ("admin", "/api/traffic/ip/192.0.2.1"),
    ("viewer", "/api/omni/employees"),
    ("admin", "/api/omni/employees"),
])
def test_business_read_denials_do_not_disclose_internal_role(role, path):
    import json
    from dashboard_routes import AccessRoutes

    class Boundary(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            self.identity = {"user": {"role": role, "id": "test-user"}, "capabilities": access.capabilities(role)}

        def _send_json(self, payload, status=200):
            self.response = (status, payload)

    handler = Boundary()
    handler.path = path
    assert handler.access_get() is True
    code, payload = handler.response
    assert code == 403
    assert "super" not in json.dumps(payload).lower()


def test_allowed_pages_defaults_and_customization(local_store):
    soporte = access.save_user({"username": "soporte.user", "name": "Usuario Soporte", "role": "soporte",
                                "password": "Ejemplo-local-2026"}, local_store["id"])
    assert soporte["allowed_pages"] == ["soporte"]

    admin = access.save_user({"username": "admin.user", "name": "Usuario Admin", "role": "admin",
                              "password": "Ejemplo-local-2026"}, local_store["id"])
    assert "soporte" not in admin["allowed_pages"]
    assert "usuarios" in admin["allowed_pages"]

    custom = access.save_user({"username": "custom.user", "name": "Usuario Custom", "role": "soporte",
                               "allowed_pages": ["soporte", "resumen"], "password": "Ejemplo-local-2026"}, local_store["id"])
    assert custom["allowed_pages"] == ["soporte", "resumen"]

    with pytest.raises(access.AccessError) as error:
        access.save_user({"username": "bad.pages", "name": "Bad Pages", "role": "soporte",
                          "allowed_pages": ["invalid-page"], "password": "Ejemplo-local-2026"}, local_store["id"])
    assert error.value.status == 422


def test_admin_hierarchy_permissions(local_store):
    admin = access.save_user({"username": "admin.hierarchy", "name": "Admin Jerarquia", "role": "admin",
                              "password": "Ejemplo-local-2026"}, local_store["id"])

    # Admin can create soporte
    soporte = access.save_user({"username": "soporte.created", "name": "Soporte Creado", "role": "soporte",
                                "password": "Ejemplo-local-2026", "allowed_pages": ["conexiones"]}, admin["id"])
    assert soporte["role"] == "soporte"
    # Admin cannot define allowed_pages, role defaults are applied
    assert soporte["allowed_pages"] == ["soporte"]

    # Admin can create another admin
    admin2 = access.save_user({"username": "admin2.created", "name": "Admin 2", "role": "admin",
                               "password": "Ejemplo-local-2026"}, admin["id"])
    assert admin2["role"] == "admin"

    # Admin cannot create super-admin
    with pytest.raises(access.AccessError) as error:
        access.save_user({"username": "super.bad", "name": "Super Bad", "role": "super-admin",
                          "password": "Ejemplo-local-2026"}, admin["id"])
    assert error.value.status == 403

    # Admin cannot modify a super-admin
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "name": "Hack Super"}, admin["id"])
    assert error.value.status == 403


def test_soporte_viewer_projection_preserves_technical_specs():
    from dashboard_routes import AccessRoutes
    handler = AccessRoutes()
    test_data = {"mac": "00:11:22:33:44:55", "serial": "SN123456", "ip": "192.168.1.50", "brand": "HP"}

    # For 'soporte', technical specs must be preserved
    handler.identity = {"user": {"role": "soporte"}}
    soporte_data = handler.viewer_projection(dict(test_data))
    assert soporte_data["mac"] == "00:11:22:33:44:55"
    assert soporte_data["serial"] == "SN123456"

    # For 'viewer', mac and serial must be redacted
    handler.identity = {"user": {"role": "viewer"}}
    viewer_data = handler.viewer_projection(dict(test_data))
    assert "mac" not in viewer_data
    assert "serial" not in viewer_data


def test_routes_access_control(local_store):
    from dashboard_routes import AccessRoutes

    class MockRoutes(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            pass

        def _send_json(self, payload, status=200):
            self.response = (status, payload)

    # 1. Soporte can access normal paths
    handler = MockRoutes()
    handler.identity = {"user": {"id": "sup-1", "role": "soporte"}, "capabilities": access.capabilities("soporte"), "csrf": "csrf"}
    for path in ("/api/devices", "/api/health", "/api/forti/network/dhcp-pools"):
        handler.path = path
        # access_get returns False for normal routes so server.py handles them
        assert handler.access_get() is False

    # 2. Both admin and super-admin can access /api/admin/users
    admin = access.save_user({"username": "adm.route", "name": "Admin Route", "role": "admin",
                              "password": "Ejemplo-local-2026"}, local_store["id"])
    handler.identity = {"user": admin, "capabilities": access.capabilities("admin"), "csrf": "csrf"}
    handler.path = "/api/admin/users"
    assert handler.access_get() is True
    status, payload = handler.response
    assert status == 200
    assert "users" in payload

    # 3. Admin can save a soporte user via /api/admin/users/save
    handler.path = "/api/admin/users/save"
    handler._body = lambda: {"username": "sop.byadmin", "name": "Soporte By Admin", "role": "soporte",
                             "password": "Ejemplo-local-2026"}
    assert handler.access_post() is True
    status, payload = handler.response
    assert status == 200
    assert payload["user"]["role"] == "soporte"

    # 4. Admin CANNOT save or test connections
    handler.path = "/api/admin/connections/forti/save"
    handler._body = lambda: {"url": "https://127.0.0.1:8001/api/v1", "auth_mode": "api-key", "secret": "abc"}
    assert handler.access_post() is True
    status, payload = handler.response
    assert status == 403

    # 5. Soporte CANNOT access /api/admin/users
    handler.identity = {"user": {"id": "sup-1", "role": "soporte"}, "capabilities": access.capabilities("soporte"), "csrf": "csrf"}
    handler.path = "/api/admin/users"
    assert handler.access_get() is True
    status, payload = handler.response
    assert status == 403


def test_login_and_session_return_allowed_pages(local_store):
    token, identity = access.login({"username": "root.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    assert "allowed_pages" in identity
    assert "allowed_pages" in identity["user"]
    assert "resumen" in identity["allowed_pages"]
    assert "conexiones" in identity["allowed_pages"]

    sess = access.session(f"sgrs_session={token}")
    assert "allowed_pages" in sess
    assert "allowed_pages" in sess["user"]
    assert sess["allowed_pages"] == identity["allowed_pages"]


def test_origins_supports_multiple_origins_and_ports(monkeypatch):
    from dashboard_routes import AccessRoutes
    routes = AccessRoutes()

    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000,http://192.168.38.250")
    origins = routes._origins()
    assert "http://192.168.38.250:3000" in origins
    assert "http://192.168.38.250" in origins
    assert "http://192.168.38.250:3001" in origins

    # Test space separated
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000 http://192.168.38.250")
    origins_space = routes._origins()
    assert "http://192.168.38.250:3000" in origins_space
    assert "http://192.168.38.250" in origins_space


def test_origins_and_boundary_with_wildcard(monkeypatch):
    from dashboard_routes import AccessRoutes
    routes = AccessRoutes()

    monkeypatch.setenv("SGRS_LAN_ORIGIN", "*")
    origins = routes._origins()
    assert "*" in origins

    # Test boundary allows any Host and Origin when wildcard is present
    routes.headers = {"Host": "any-host.lan", "Origin": "http://any-host.lan"}
    # Should not raise AccessError
    routes._boundary(mutation=False)


