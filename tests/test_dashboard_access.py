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


def test_ordinary_admin_cannot_create_viewer_or_escalate_roles(local_store):
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


def test_last_root_role_change_and_stale_writes_are_denied(local_store):
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "active": True, "role": "viewer", "confirmed": True}, local_store["id"])
    assert error.value.status == 409
    assert "al menos un super-admin" in str(error.value)
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "active": True, "version": 0}, local_store["id"])
    assert error.value.status == 409


def test_self_role_change_requires_confirmation_and_revokes_session(local_store):
    access.save_user({"username": "backup.root", "name": "Responsable alterno", "role": "super-admin", "password": "Ejemplo-local-2026"}, local_store["id"])
    token, _ = access.login({"username": "root.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    body = {**local_store, "active": True, "role": "admin"}
    with pytest.raises(access.AccessError) as error:
        access.save_user(body, local_store["id"])
    assert error.value.status == 409
    assert "Confirma" in str(error.value)
    saved = access.save_user({**body, "confirmed": True}, local_store["id"])
    assert saved["role"] == "admin"
    assert access.session(f"sgrs_session={token}") is None
    _, identity = access.login({"username": "root.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    assert "integrations.manage" not in identity["capabilities"]
    with pytest.raises(access.AccessError):
        access.save_user({**saved, "active": True, "role": "super-admin", "confirmed": True}, saved["id"])


def test_self_suspension_stays_denied_with_another_root(local_store):
    access.save_user({"username": "backup.root", "name": "Responsable alterno", "role": "super-admin", "password": "Ejemplo-local-2026"}, local_store["id"])
    with pytest.raises(access.AccessError) as error:
        access.save_user({**local_store, "active": False, "confirmed": True}, local_store["id"])
    assert error.value.status == 409
    assert "suspender tu propia" in str(error.value)


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


def test_legacy_root_empty_pages_restore_navigation_without_elevating_operators(local_store):
    with access.database(write=True) as db:
        db.execute("UPDATE users SET allowed_pages='[]' WHERE id=?", (local_store["id"],))
    token, identity = access.login({"username": "root.local", "password": "Ejemplo-local-2026"}, "127.0.0.1")
    assert identity["allowed_pages"] == access.ROLE_PAGE_DEFAULTS["super-admin"]
    assert access.session(f"sgrs_session={token}")["allowed_pages"] == identity["allowed_pages"]
    for role in ("admin", "soporte", "viewer"):
        assert access.parse_allowed_pages("[]", role) == []
    assert access.parse_allowed_pages('["resumen"]', "super-admin") == ["resumen"]


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
    # An admin cannot define allowed_pages or read the assigned page list.
    assert "allowed_pages" not in soporte
    with access.database() as db:
        stored_pages = db.execute("SELECT allowed_pages FROM users WHERE id=?", (soporte["id"],)).fetchone()[0]
    assert stored_pages == '["soporte"]'

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


def test_hidden_users_and_super_admin_projection(local_store):
    import json
    admin = access.save_user({"username": "admin.hidden", "name": "Admin Operativo", "role": "admin",
                              "password": "Ejemplo-local-2026"}, local_store["id"])
    super_user = access.save_user({"username": "root.visible", "name": "Admin Interno", "role": "super-admin",
                                   "password": "Ejemplo-local-2026"}, local_store["id"])
    hidden = access.save_user({"username": "cuenta.oculta", "name": "Cuenta Reservada", "role": "soporte",
                               "password": "Ejemplo-local-2026", "is_hidden": True}, local_store["id"])

    # 1. Admin view: super-admin accounts are projected as 'admin', hidden accounts are omitted
    ordinary = access.list_users(admin["id"])
    projected = next(user for user in ordinary if user["id"] == super_user["id"])
    assert projected["role"] == "admin"
    assert "allowed_pages" not in projected and "is_hidden" not in projected
    assert hidden["id"] not in {user["id"] for user in ordinary}
    # Ensure no admin view item leaks internal roles, modular pages, or hidden status
    for u in ordinary:
        assert u["role"] != "super-admin"
        assert "allowed_pages" not in u
        assert "is_hidden" not in u
        assert "password" not in u and "password_hash" not in u
    assert "super-admin" not in json.dumps(ordinary).lower()

    # 2. Super-admin view: all accounts retain their real roles, allowed_pages, and visibility flags
    super_view = access.list_users(local_store["id"])
    real_super = next(u for u in super_view if u["id"] == super_user["id"])
    assert real_super["role"] == "super-admin"
    assert isinstance(real_super["allowed_pages"], list)
    assert real_super["is_hidden"] is False
    real_hidden = next(u for u in super_view if u["id"] == hidden["id"])
    assert real_hidden["role"] == "soporte"
    assert real_hidden["is_hidden"] is True

    # 3. Admin cannot modify projected super-admin account even when sending role='admin'
    with pytest.raises(access.AccessError) as error:
        access.save_user({
            "id": projected["id"],
            "username": projected["username"],
            "name": "Intento Modificar",
            "role": "admin",
            "version": projected["version"],
            "confirmed": True,
        }, admin["id"])
    assert error.value.status == 403
    assert "No tienes permiso para modificar esta cuenta" in str(error.value)

    # 4. Admin cannot change password or suspend super-admin account
    with pytest.raises(access.AccessError) as error:
        access.save_user({
            "id": projected["id"],
            "username": projected["username"],
            "name": projected["name"],
            "role": "admin",
            "password": "Nueva-password-2026",
            "version": projected["version"],
            "confirmed": True,
        }, admin["id"])
    assert error.value.status == 403

    with pytest.raises(access.AccessError) as error:
        access.save_user({
            "id": projected["id"],
            "username": projected["username"],
            "name": projected["name"],
            "role": "admin",
            "active": False,
            "version": projected["version"],
            "confirmed": True,
        }, admin["id"])
    assert error.value.status == 403

    # 5. Hidden account handling
    with pytest.raises(access.AccessError) as error:
        access.save_user({**{key: value for key, value in hidden.items() if key not in ("is_hidden", "active")}, "active": True}, admin["id"])
    assert error.value.status == 404
    with pytest.raises(access.AccessError) as error:
        access.save_user({"username": "hidden.by.admin", "name": "Intento", "role": "soporte",
                          "password": "Ejemplo-local-2026", "is_hidden": True}, admin["id"])
    assert error.value.status == 403

    assert hidden["is_hidden"] is True
    visible_again = access.save_user({**hidden, "is_hidden": False, "active": True}, local_store["id"])
    assert visible_again["is_hidden"] is False
    assert any(user["id"] == hidden["id"] for user in access.list_users(admin["id"]))


def test_hidden_account_attribution_is_redacted(local_store):
    from dashboard_access import project_hidden_actors
    hidden = access.save_user({"username": "private.actor", "name": "Nombre Reservado", "role": "admin",
                               "password": "Ejemplo-local-2026", "is_hidden": True}, local_store["id"])
    response = project_hidden_actors({"tech": "Nombre Reservado", "actor_id": hidden["id"],
                                      "incident": {"resolved_by": hidden["id"]}})
    assert response["tech"] == "Cuenta reservada"
    assert "actor_id" not in response
    assert "resolved_by" not in response["incident"]


def test_upstream_credential_fields_are_never_forwarded():
    from dashboard_security import sanitize_upstream
    response = sanitize_upstream({
        "user": {"userPassword": "secret-value", "apiKey": "key-value", "sessionId": "session-value"},
        "accessToken": "bearer-value", "label": "visible",
    }, ("integration-secret",))
    assert response["user"] == {"userPassword": "******", "apiKey": "******", "sessionId": "******"}
    assert response["accessToken"] == "******"
    assert response["label"] == "visible"


def test_soporte_viewer_projection_preserves_technical_specs(local_store):
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
    handler.headers = {"Origin": "http://localhost:3000"}
    handler.client_address = ("127.0.0.1", 1234)
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
    projected_root = next(row for row in payload["users"] if row["id"] == local_store["id"])
    assert projected_root["role"] == "admin"
    assert "allowed_pages" not in projected_root and "is_hidden" not in projected_root
    assert not any("password" in key.lower() or "hash" in key.lower() for row in payload["users"] for key in row)

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

    # 5. Super-admin accessing /api/admin/users sees real roles, allowed_pages and is_hidden
    handler.identity = {"user": local_store, "capabilities": access.capabilities("super-admin"), "csrf": "csrf"}
    handler.path = "/api/admin/users"
    assert handler.access_get() is True
    status, payload = handler.response
    assert status == 200
    root_row = next(row for row in payload["users"] if row["id"] == local_store["id"])
    assert root_row["role"] == "super-admin"
    assert "allowed_pages" in root_row and isinstance(root_row["allowed_pages"], list)
    assert "is_hidden" in root_row and isinstance(root_row["is_hidden"], bool)

    # 6. Admin CANNOT modify a super-admin via /api/admin/users/save
    handler.identity = {"user": admin, "capabilities": access.capabilities("admin"), "csrf": "csrf"}
    handler.path = "/api/admin/users/save"
    handler._body = lambda: {
        "id": local_store["id"],
        "username": local_store["username"],
        "name": "Intento Modificar Root",
        "role": "admin",
        "version": local_store["version"],
        "confirmed": True,
    }
    assert handler.access_post() is True
    status, payload = handler.response
    assert status == 403
    assert "No tienes permiso para modificar esta cuenta" in payload.get("error", "")

    # 7. Admin CANNOT create a super-admin via /api/admin/users/save
    handler.path = "/api/admin/users/save"
    handler._body = lambda: {
        "username": "hack.super",
        "name": "Hack Super",
        "role": "super-admin",
        "password": "Ejemplo-local-2026",
        "confirmed": True,
    }
    assert handler.access_post() is True
    status, payload = handler.response
    assert status == 403

    # 8. Soporte CANNOT access /api/admin/users
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


def test_wildcard_origin_is_ignored(monkeypatch):
    from dashboard_routes import AccessRoutes
    routes = AccessRoutes()

    monkeypatch.setenv("SGRS_LAN_ORIGIN", "*")
    origins = routes._origins()
    assert "*" not in origins

    # Test boundary allows any Host and Origin when wildcard is present
    routes.headers = {"Host": "any-host.lan", "Origin": "http://any-host.lan"}
    with pytest.raises(access.AccessError):
        routes._boundary(mutation=False)


def test_data_contract_users_and_privileges_projection(local_store):
    import json
    # Seed multiple user types
    super2 = access.save_user({"username": "super2.ops", "name": "Super Ops", "role": "super-admin",
                               "password": "Ejemplo-local-2026", "allowed_pages": ["resumen", "conexiones"]}, local_store["id"])
    super_hidden = access.save_user({"username": "super.hidden", "name": "Super Secreto", "role": "super-admin",
                                     "password": "Ejemplo-local-2026", "is_hidden": True}, local_store["id"])
    admin_user = access.save_user({"username": "admin.viewer", "name": "Admin Visualizador", "role": "admin",
                                   "password": "Ejemplo-local-2026"}, local_store["id"])
    soporte_user = access.save_user({"username": "soporte.tech", "name": "Soporte Tecnico", "role": "soporte",
                                     "password": "Ejemplo-local-2026"}, local_store["id"])

    # --- 1. Unit Contract: user_for_actor ---
    with access.database() as db:
        row_super = db.execute("SELECT * FROM users WHERE id=?", (super2["id"],)).fetchone()
        row_hidden = db.execute("SELECT * FROM users WHERE id=?", (super_hidden["id"],)).fetchone()
        row_admin = db.execute("SELECT * FROM users WHERE id=?", (admin_user["id"],)).fetchone()
        row_soporte = db.execute("SELECT * FROM users WHERE id=?", (soporte_user["id"],)).fetchone()

    # Projection for super-admin:
    super_view_super = access.user_for_actor(row_super, "super-admin")
    assert super_view_super["role"] == "super-admin"
    assert super_view_super["is_hidden"] is False
    assert super_view_super["allowed_pages"] == ["resumen", "conexiones"]
    assert "password_hash" not in super_view_super and "password" not in super_view_super

    super_view_hidden = access.user_for_actor(row_hidden, "super-admin")
    assert super_view_hidden["role"] == "super-admin"
    assert super_view_hidden["is_hidden"] is True

    # Projection for admin:
    admin_view_super = access.user_for_actor(row_super, "admin")
    assert admin_view_super["role"] == "admin"  # Projected
    assert "allowed_pages" not in admin_view_super  # Redacted
    assert "is_hidden" not in admin_view_super  # Redacted
    assert set(admin_view_super.keys()) == {"id", "username", "name", "role", "active", "version", "created_at"}

    admin_view_admin = access.user_for_actor(row_admin, "admin")
    assert admin_view_admin["role"] == "admin"
    assert "allowed_pages" not in admin_view_admin
    assert "is_hidden" not in admin_view_admin

    admin_view_soporte = access.user_for_actor(row_soporte, "admin")
    assert admin_view_soporte["role"] == "soporte"
    assert "allowed_pages" not in admin_view_soporte
    assert "is_hidden" not in admin_view_soporte

    # --- 2. Directory Contract: list_users ---
    # Super-admin directory listing
    dir_super = access.list_users(local_store["id"])
    assert len(dir_super) == 5  # local_store + super2 + super_hidden + admin_user + soporte_user
    assert any(u["id"] == super_hidden["id"] for u in dir_super)
    assert sum(1 for u in dir_super if u["role"] == "super-admin") == 3
    assert sum(1 for u in dir_super if u["role"] == "admin") == 1
    assert sum(1 for u in dir_super if u["role"] == "soporte") == 1
    for u in dir_super:
        assert isinstance(u["allowed_pages"], list)
        assert isinstance(u["is_hidden"], bool)

    # Admin directory listing
    dir_admin = access.list_users(admin_user["id"])
    assert len(dir_admin) == 4  # super_hidden is excluded
    assert not any(u["id"] == super_hidden["id"] for u in dir_admin)
    # No user has role super-admin; super-admin accounts are projected as admin
    assert all(u["role"] != "super-admin" for u in dir_admin)
    assert sum(1 for u in dir_admin if u["role"] == "admin") == 3  # local_store + super2 + admin_user
    assert sum(1 for u in dir_admin if u["role"] == "soporte") == 1
    for u in dir_admin:
        assert "allowed_pages" not in u
        assert "is_hidden" not in u
    assert "super-admin" not in json.dumps(dir_admin).lower()

    # --- 3. Mutation & Security Control ---
    # Admin cannot touch super-admin even using the projected 'admin' structure
    proj = next(u for u in dir_admin if u["id"] == super2["id"])
    assert proj["role"] == "admin"
    with pytest.raises(access.AccessError) as err:
        access.save_user({**proj, "name": "Intento de Admin", "confirmed": True}, admin_user["id"])
    assert err.value.status == 403
    assert "No tienes permiso para modificar esta cuenta" in str(err.value)

    # Admin cannot create super-admin
    with pytest.raises(access.AccessError) as err:
        access.save_user({"username": "nuevo.super", "name": "Super", "role": "super-admin",
                          "password": "Ejemplo-local-2026"}, admin_user["id"])
    assert err.value.status == 403

    # Admin cannot set is_hidden flag
    with pytest.raises(access.AccessError) as err:
        access.save_user({"username": "nuevo.adm", "name": "Admin", "role": "admin",
                          "password": "Ejemplo-local-2026", "is_hidden": True}, admin_user["id"])
    assert err.value.status == 403

    # Admin creating user with custom allowed_pages: custom pages are ignored, defaults applied
    created_soporte = access.save_user({
        "username": "soporte.clean", "name": "Soporte Limpio", "role": "soporte",
        "password": "Ejemplo-local-2026", "allowed_pages": ["conexiones", "usuarios"]
    }, admin_user["id"])
    assert "allowed_pages" not in created_soporte
    with access.database() as db:
        stored = db.execute("SELECT allowed_pages FROM users WHERE id=?", (created_soporte["id"],)).fetchone()[0]
    assert stored == json.dumps(access.ROLE_PAGE_DEFAULTS["soporte"])

    # Soporte cannot list or save users
    with pytest.raises(access.AccessError) as err:
        access.list_users(soporte_user["id"])
    assert err.value.status == 403

    with pytest.raises(access.AccessError) as err:
        access.save_user({"username": "hacker.user", "name": "Hacker", "role": "admin",
                          "password": "Ejemplo-local-2026"}, soporte_user["id"])
    assert err.value.status == 403

