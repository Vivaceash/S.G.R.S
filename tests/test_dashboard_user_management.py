import pytest

import dashboard_access as access


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path / "private")
    monkeypatch.delenv("SGRS_INITIAL_USER_PASSWORD", raising=False)
    root = access.save_user({
        "username": "root.local",
        "name": "Responsable local",
        "role": "super-admin",
        "password": "Root-local-2026",
    }, bootstrap=True)
    return root


def test_capabilities_are_separate_and_inherited(store):
    admin_caps = access.capabilities("admin")
    admin = access.save_user({
        "username": "admin.local",
        "name": "Administrador local",
        "role": "admin",
        "capabilities": admin_caps,
        "password": "Admin-local-2026",
    }, store["id"])

    child = access.save_user({
        "username": "support.local",
        "name": "Soporte local",
        "role": "soporte",
        "capabilities": [*admin_caps, "integrations.manage"],
        "password": "Support-local-2026",
    }, admin["id"])
    assert set(child["capabilities"]) == set(admin_caps)
    assert "integrations.manage" not in child["capabilities"]

    with pytest.raises(access.AccessError) as error:
        access.save_user({
            "username": "root.child",
            "name": "Intento de escalación",
            "role": "super-admin",
            "password": "Escalation-2026",
        }, admin["id"])
    assert error.value.status == 403


def test_hierarchy_controls_edit_and_delete_separately(store):
    admin = access.save_user({
        "username": "admin.local",
        "name": "Administrador local",
        "role": "admin",
        "capabilities": access.capabilities("admin"),
        "password": "Admin-local-2026",
    }, store["id"])
    peer = access.save_user({
        "username": "admin.peer",
        "name": "Administrador par",
        "role": "admin",
        "capabilities": access.capabilities("admin"),
        "password": "Peer-local-2026",
    }, store["id"])
    support = access.save_user({
        "username": "support.local",
        "name": "Soporte local",
        "role": "soporte",
        "password": "Support-local-2026",
    }, admin["id"])

    with pytest.raises(access.AccessError) as error:
        access.save_user({**peer, "name": "Cambio no autorizado"}, admin["id"])
    assert error.value.status == 403

    updated = access.save_user({**support, "name": "Soporte actualizado"}, admin["id"])
    assert updated["name"] == "Soporte actualizado"

    with access.database(write=True) as db:
        db.execute("INSERT INTO dashboard_preferences VALUES(?,?,?)", (support["id"], "[]", 1))
    assert access.delete_user(admin["id"], {"id": support["id"], "version": updated["version"]}) == {"deleted": True}
    with access.database() as db:
        assert db.execute("SELECT 1 FROM users WHERE id=?", (support["id"],)).fetchone() is None
        assert db.execute("SELECT 1 FROM dashboard_preferences WHERE user_id=?", (support["id"],)).fetchone() is None
        event = db.execute("SELECT action,target,details FROM audit WHERE action='user.deleted' ORDER BY id DESC LIMIT 1").fetchone()
    assert event["target"] == "usuario eliminado"
    assert support["username"] not in event["details"]


def test_initial_password_requires_change_and_is_configured_once(store, monkeypatch):
    monkeypatch.setenv("SGRS_INITIAL_USER_PASSWORD", "issste2026")
    user = access.save_user({"username": "new.local", "name": "Cuenta nueva", "role": "viewer"}, store["id"])
    token, identity = access.login({"username": "new.local", "password": "issste2026"}, "127.0.0.1")
    assert identity["must_change_password"] is True
    current = access.session(f"sgrs_session={token}")
    changed = access.change_password(user["id"], current["token_hash"], {
        "password": "New-password-2026",
        "password_confirmation": "New-password-2026",
    })
    assert changed["must_change_password"] is False
    access.login({"username": "new.local", "password": "New-password-2026"}, "127.0.0.1")


def test_hidden_superadmin_is_reused_without_overwriting_password(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path / "private")
    monkeypatch.setenv("SGRS_INITIAL_USER_PASSWORD", "issste2026")
    first = access.ensure_hidden_superadmin()
    with access.database() as db:
        original = db.execute("SELECT password_hash FROM users WHERE id=?", (first,)).fetchone()[0]
    monkeypatch.setenv("SGRS_INITIAL_USER_PASSWORD", "another-pass-2026")
    assert access.ensure_hidden_superadmin() == first
    with access.database() as db:
        row = db.execute("SELECT username,role,is_hidden,password_hash FROM users WHERE id=?", (first,)).fetchone()
    assert dict(row)["username"] == "super.admin"
    assert dict(row)["role"] == "super-admin"
    assert dict(row)["is_hidden"] == 1
    assert dict(row)["password_hash"] == original
