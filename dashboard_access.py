"""Local dashboard identity and integration configuration. No external dependencies.

Provision the first account with: python dashboard_access.py bootstrap
The server may ensure the hidden recovery account `super.admin` from
SGRS_INITIAL_USER_PASSWORD at startup; this module performs no network calls on import.
"""
import base64
import getpass
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit

PRIVATE = Path(__file__).resolve().parent / ".sgrs-private"
ROLES = ("soporte", "viewer", "admin", "super-admin")
READ = ["dashboard.read", "inventory.read", "idf.read", "activity.read"]
OPERATE = ["inventory.write", "idf.visits.write", "inventory.export"]
MANAGE = ["integrations.manage", "traffic.read"]
USER_MANAGEMENT = ["users.read", "users.create", "users.edit", "users.delete"]
ROLE_RANK = {"soporte": 1, "viewer": 1, "admin": 2, "super-admin": 3}
KNOWN_CAPABILITIES = tuple(dict.fromkeys(READ + OPERATE + MANAGE + USER_MANAGEMENT))
SESSION_SECONDS = 8 * 3600
IDLE_SECONDS = 30 * 60

AVAILABLE_PAGES = (
    "resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "bitacora-idf",
    "aps", "cctv", "altas", "soporte", "usuarios", "conexiones"
)
SUBMODULES = {
    'soporte': ('live', 'log', 'inventory'),
    'aps': ('live', 'documentary', 'map'),
    'cctv': ('updated', 'original'),
    'idf': ('activity', 'inventory', 'qr'),
    'altas': ('oficios', 'all'),
    'disponibilidad': ('list', 'matrix'),
}
AVAILABLE_SUBMODULES = frozenset(f'{page}:{tab}' for page, tabs in SUBMODULES.items() for tab in tabs)

ROLE_PAGE_DEFAULTS = {
    "soporte": ["soporte"],
    "admin": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "bitacora-idf", "aps", "cctv", "altas", "usuarios"],
    "super-admin": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "bitacora-idf", "aps", "cctv", "altas", "soporte", "usuarios", "conexiones"],
    "viewer": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "bitacora-idf", "aps", "cctv", "altas"],
}

ROLE_CATALOG = {
    "soporte": {
        "id": "soporte",
        "title": "Soporte",
        "description": "Atención y diagnóstico técnico: consulta de dispositivos, fichas técnicas y DHCP.",
    },
    "viewer": {
        "id": "viewer",
        "title": "Viewer",
        "description": "Consulta el dashboard, inventario y reportes. No puede registrar ni modificar datos.",
    },
    "admin": {
        "id": "admin",
        "title": "Administrador",
        "description": "Administra la operación: inventario, visitas e incidencias de IDF y gestión de usuarios.",
    },
    "super-admin": {
        "id": "super-admin",
        "title": "Superusuario",
        "description": "Gestiona cuentas, privilegios, conexiones y consultas técnicas reservadas.",
    },
}


class AccessError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def capabilities(role):
    if role == "super-admin":
        return READ + OPERATE + MANAGE + USER_MANAGEMENT
    if role == "admin":
        return READ + OPERATE + USER_MANAGEMENT
    if role in ("viewer", "soporte"):
        return READ
    return []


def parse_capabilities(raw, role=None):
    if raw is None:
        return list(capabilities(role)) if role else []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return list(capabilities(role)) if role else []
    if not isinstance(raw, list):
        return list(capabilities(role)) if role else []
    return list(dict.fromkeys(value for value in raw if isinstance(value, str) and value in KNOWN_CAPABILITIES))


def row_capabilities(row):
    raw = row["capabilities"] if "capabilities" in row.keys() else None
    return parse_capabilities(raw, row["role"])


def role_rank(role):
    return ROLE_RANK.get(role, 0)


def can_edit_target(actor, target):
    if actor["id"] == target["id"]:
        return False
    if actor["role"] == "super-admin":
        return True
    return role_rank(target["role"]) < role_rank(actor["role"])


def can_create_role(actor, role):
    return role in ROLES and role_rank(role) <= role_rank(actor["role"])


def visible_roles(role):
    """Return roles available to the account's hierarchy-aware user form."""
    if role == "super-admin":
        return [ROLE_CATALOG["soporte"], ROLE_CATALOG["viewer"], ROLE_CATALOG["admin"], ROLE_CATALOG["super-admin"]]
    if role == "admin":
        return [ROLE_CATALOG["soporte"], ROLE_CATALOG["viewer"], ROLE_CATALOG["admin"]]
    if role in ("soporte", "viewer"):
        return [ROLE_CATALOG["soporte"], ROLE_CATALOG["viewer"]]
    return []


def parse_allowed_pages(raw_pages, role):
    if isinstance(raw_pages, str):
        try:
            pages = json.loads(raw_pages)
        except Exception:
            pages = None
    elif isinstance(raw_pages, (list, tuple)):
        pages = list(raw_pages)
    else:
        pages = None
    valid = [p for p in pages if isinstance(p, str) and p in AVAILABLE_PAGES] if isinstance(pages, (list, tuple)) else []
    # Legacy root accounts stored [] before page permissions existed. Keep their
    # administration reachable without granting pages to restricted operators.
    if pages == [] and role == "super-admin":
        return list(ROLE_PAGE_DEFAULTS[role])
    return valid if isinstance(pages, list) else list(ROLE_PAGE_DEFAULTS.get(role, []))


def default_submodules(pages):
    return [f'{page}:{tab}' for page, tabs in SUBMODULES.items() if page in pages for tab in tabs]


def parse_allowed_submodules(raw_submodules, pages):
    if raw_submodules is None:
        return default_submodules(pages)
    if isinstance(raw_submodules, str):
        try:
            raw_submodules = json.loads(raw_submodules)
        except (TypeError, ValueError):
            return default_submodules(pages)
    if not isinstance(raw_submodules, list):
        return default_submodules(pages)
    return list(dict.fromkeys(item for item in raw_submodules
                              if isinstance(item, str) and item in AVAILABLE_SUBMODULES
                              and item.split(':', 1)[0] in pages))


def validate_submodules(raw_submodules, pages):
    if not isinstance(raw_submodules, list) or not all(isinstance(item, str) and item in AVAILABLE_SUBMODULES and item.split(':', 1)[0] in pages for item in raw_submodules):
        raise AccessError(422, 'Lista de submódulos permitidos no válida.')
    selected = list(dict.fromkeys(raw_submodules))
    if any(page in pages and not any(item.startswith(page + ':') for item in selected) for page in SUBMODULES):
        raise AccessError(422, 'Selecciona al menos una pestaña por cada módulo habilitado.')
    return selected


def session_identity(row, csrf):
    user = public_user(row)
    return {
        "user": user,
        "csrf": csrf,
        "capabilities": row_capabilities(row),
        "roles": visible_roles(row["role"]),
        "allowed_pages": user["allowed_pages"],
        "allowed_submodules": user["allowed_submodules"],
        "must_change_password": bool(row["must_change_password"]),
    }


def identity_pages(identity):
    raw = identity.get("allowed_pages", identity.get("user", {}).get("allowed_pages"))
    if isinstance(raw, list):
        return [page for page in raw if page in AVAILABLE_PAGES]
    return parse_allowed_pages(raw, identity["user"]["role"])


def identity_submodules(identity):
    raw = identity.get('allowed_submodules', identity.get('user', {}).get('allowed_submodules'))
    return parse_allowed_submodules(raw, identity_pages(identity))


def migrate_idf_overview_pages(db):
    """Preserve existing overview access once; later explicit revocations stay revoked."""
    migration = "idf-overview-page-v1"
    if db.execute("SELECT 1 FROM dashboard_migrations WHERE id=?", (migration,)).fetchone():
        return
    claimed = db.execute("INSERT OR IGNORE INTO dashboard_migrations(id, applied_at) VALUES (?,?)",
                         (migration, int(time.time())))
    if not claimed.rowcount:
        return
    for row in db.execute("SELECT id, role, allowed_pages FROM users").fetchall():
        pages = parse_allowed_pages(row["allowed_pages"], row["role"])
        if "idf" in pages and "bitacora" in pages and "bitacora-idf" not in pages:
            db.execute("UPDATE users SET allowed_pages=?, version=version+1 WHERE id=?",
                       (json.dumps([*pages, "bitacora-idf"]), row["id"]))


def migrate_user_capabilities(db):
    """Give legacy accounts the role baseline once; later empty lists are intentional."""
    migration = "user-capabilities-v1"
    if db.execute("SELECT 1 FROM dashboard_migrations WHERE id=?", (migration,)).fetchone():
        return
    claimed = db.execute("INSERT OR IGNORE INTO dashboard_migrations(id, applied_at) VALUES (?,?)",
                         (migration, int(time.time())))
    if not claimed.rowcount:
        return
    for row in db.execute("SELECT id,role,capabilities FROM users").fetchall():
        try:
            stored = json.loads(row["capabilities"] or "[]")
        except (TypeError, ValueError):
            stored = []
        if not stored:
            db.execute("UPDATE users SET capabilities=? WHERE id=?",
                       (json.dumps(capabilities(row["role"])), row["id"]))


def migrate_user_delete_capability(db):
    """Add the separate deletion capability to legacy management accounts once."""
    migration = "user-delete-capability-v1"
    if db.execute("SELECT 1 FROM dashboard_migrations WHERE id=?", (migration,)).fetchone():
        return
    claimed = db.execute("INSERT OR IGNORE INTO dashboard_migrations(id, applied_at) VALUES (?,?)",
                         (migration, int(time.time())))
    if not claimed.rowcount:
        return
    for row in db.execute("SELECT id,capabilities FROM users").fetchall():
        stored = parse_capabilities(row["capabilities"])
        if "users.edit" in stored and "users.delete" not in stored:
            db.execute("UPDATE users SET capabilities=? WHERE id=?",
                       (json.dumps([*stored, "users.delete"]), row["id"]))


def seed_support_inventory(db):
    migration = 'support-idf3-inventory-v1'
    if db.execute('SELECT 1 FROM dashboard_migrations WHERE id=?', (migration,)).fetchone():
        return
    source = Path(__file__).resolve().parent / 'data' / 'support_idf3_initial.json'
    if source.exists() and not db.execute('SELECT 1 FROM support_inventory LIMIT 1').fetchone():
        snapshot = json.loads(source.read_text(encoding='utf-8'))
        db.executemany('''INSERT INTO support_inventory
            (id, idf_id, source_number, description, quantity, unit, location, status, notes, source_file, source_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', [
            (f"idf3-{item['source_number']:03d}", snapshot['idf_id'], item['source_number'],
             item['description'], item['quantity'], item['unit'], item['location'], item['status'],
             item['notes'], snapshot['source'], snapshot['source_date']) for item in snapshot['items']
        ])
    db.execute('INSERT INTO dashboard_migrations(id, applied_at) VALUES (?, ?)', (migration, int(time.time())))


@contextmanager
def database(write=False):
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    path = PRIVATE / "dashboard.sqlite3"
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript("""
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            allowed_pages TEXT NOT NULL DEFAULT '[]', allowed_submodules TEXT,
            capabilities TEXT NOT NULL DEFAULT '[]',
            must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)));
          CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
            expires INTEGER NOT NULL, touched INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY, url TEXT NOT NULL, auth_mode TEXT NOT NULL,
            username TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '',
            version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS dashboard_preferences (
            user_id TEXT PRIMARY KEY,
            principal_segments TEXT NOT NULL,
            updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS dashboard_migrations (
            id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS attempts (bucket TEXT NOT NULL, created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
            target TEXT NOT NULL, created_at INTEGER NOT NULL,
            details TEXT NOT NULL DEFAULT '');
          CREATE TABLE IF NOT EXISTS metric_samples (
            sampled_at INTEGER PRIMARY KEY, metrics TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS inventory_edits (
            asset_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
            fields TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS support_inventory (
            id TEXT PRIMARY KEY, idf_id TEXT NOT NULL, source_number INTEGER NOT NULL,
            description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0),
            unit TEXT NOT NULL, location TEXT NOT NULL, status TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL, source_date TEXT NOT NULL,
            UNIQUE(idf_id, source_number));
          CREATE INDEX IF NOT EXISTS idx_support_inventory_idf ON support_inventory(idf_id, source_number);
          CREATE TABLE IF NOT EXISTS support_inventory_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id TEXT NOT NULL,
            before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
            delta INTEGER NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL,
            actor_name TEXT NOT NULL, created_at TEXT NOT NULL,
            movement_id TEXT UNIQUE);
          CREATE TABLE IF NOT EXISTS ap_map_positions (
            ap_id TEXT PRIMARY KEY, ap_mac TEXT NOT NULL DEFAULT '', ap_serial TEXT NOT NULL DEFAULT '',
            floor_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, label TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS device_connection_history (
            mac TEXT PRIMARY KEY,
            ip TEXT NOT NULL,
            hostname TEXT,
            device_type TEXT NOT NULL DEFAULT 'Computadora',
            vendor TEXT,
            serial TEXT,
            first_connected_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            current_session_seconds INTEGER NOT NULL DEFAULT 0,
            total_connected_seconds INTEGER NOT NULL DEFAULT 0,
            is_online INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_device_history_type_streak
          ON device_connection_history(device_type, is_online, current_session_seconds DESC);
        """)
        cols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        had_capabilities = "capabilities" in cols
        if "allowed_pages" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN allowed_pages TEXT NOT NULL DEFAULT '[]'")
        if "allowed_submodules" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN allowed_submodules TEXT")
        if "is_hidden" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0,1))")
        if "capabilities" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'")
        if "must_change_password" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))")
        audit_cols = [r[1] for r in db.execute("PRAGMA table_info(audit)").fetchall()]
        if "details" not in audit_cols:
            db.execute("ALTER TABLE audit ADD COLUMN details TEXT NOT NULL DEFAULT ''")
        if not had_capabilities:
            for row in db.execute("SELECT id,role FROM users").fetchall():
                db.execute("UPDATE users SET capabilities=? WHERE id=?", (json.dumps(capabilities(row["role"])), row["id"]))
        else:
            for row in db.execute("SELECT id,role,capabilities FROM users").fetchall():
                if row["capabilities"] is None:
                    db.execute("UPDATE users SET capabilities=? WHERE id=?", (json.dumps(capabilities(row["role"])), row["id"]))
        support_cols = [r[1] for r in db.execute("PRAGMA table_info(support_inventory)").fetchall()]
        if "version" not in support_cols:
            db.execute("ALTER TABLE support_inventory ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
        dh_cols = [r[1] for r in db.execute("PRAGMA table_info(device_connection_history)").fetchall()]
        if "serial" not in dh_cols and dh_cols:
            db.execute("ALTER TABLE device_connection_history ADD COLUMN serial TEXT")
        if write:
            db.execute("BEGIN IMMEDIATE")
        seed_support_inventory(db)
        migrate_idf_overview_pages(db)
        migrate_user_capabilities(db)
        migrate_user_delete_capability(db)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def public_user(row):
    user = {k: row[k] for k in ("id", "username", "name", "role", "version", "created_at")}
    user["active"] = bool(row["active"])
    raw_pages = row.get("allowed_pages") if hasattr(row, "get") else (row["allowed_pages"] if "allowed_pages" in row.keys() else None)
    user["allowed_pages"] = parse_allowed_pages(raw_pages, row["role"])
    raw_submodules = row['allowed_submodules'] if 'allowed_submodules' in row.keys() else None
    user['allowed_submodules'] = parse_allowed_submodules(raw_submodules, user['allowed_pages'])
    return user


def user_for_actor(row, actor, include_permissions=None):
    """Directory projection only; never use this representation to authorize."""
    user = public_user(row)
    actor_is_row = isinstance(actor, (dict, sqlite3.Row))
    actor_role = actor["role"] if actor_is_row else actor
    if include_permissions is None:
        include_permissions = actor_role == "super-admin" or (actor_is_row and can_edit_target(actor, row))
    if include_permissions:
        user["capabilities"] = row_capabilities(row)
        user["is_hidden"] = bool(row["is_hidden"] if "is_hidden" in row.keys() else 0)
    else:
        user.pop("allowed_pages", None)
        user.pop("allowed_submodules", None)
        user.pop("capabilities", None)
        user.pop("is_hidden", None)
    return user


def list_users(actor):
    with database() as db:
        viewer = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
        if not viewer or "users.read" not in row_capabilities(viewer):
            raise AccessError(403, "No tienes permiso para acceder a esta sección.")
        clause = "" if viewer["role"] == "super-admin" else "WHERE is_hidden=0"
        return [user_for_actor(row, viewer) for row in db.execute(
            f"SELECT * FROM users {clause} ORDER BY created_at DESC,id")]


def project_hidden_actors(data):
    """Redact structured attribution, preserving stored records and their keys."""
    with database() as db:
        rows = db.execute("SELECT id,name,username FROM users WHERE is_hidden=1").fetchall()
    identifiers = {row["id"] for row in rows}
    names = {value for row in rows for value in (row["name"], row["username"])}
    id_fields = {"actor_id", "resolved_by", "updated_by", "created_by"}
    name_fields = {"tech", "actor", "reporter", "responsable", "username"}

    def clean(value):
        if isinstance(value, list):
            return [clean(item) for item in value]
        if not isinstance(value, dict):
            return value
        hidden_author = value.get("actor_id") in identifiers if isinstance(value.get("actor_id"), str) else False
        result = {}
        for key, item in value.items():
            if key in id_fields and isinstance(item, str) and item in identifiers:
                continue
            if key in name_fields and (hidden_author or (isinstance(item, str) and item in names | identifiers)):
                result[key] = "Cuenta reservada"
            else:
                result[key] = clean(item)
        return result

    return clean(data)


def audit(db, actor, action, target, details=None):
    encoded_details = ""
    if details is not None:
        encoded_details = json.dumps(details, ensure_ascii=False, separators=(",", ":"))
    db.execute("INSERT INTO audit(actor,action,target,created_at,details) VALUES(?,?,?,?,?)",
               (actor, action, target, int(time.time()), encoded_details))


def password_hash(password, initial=False):
    minimum = 8 if initial else 12
    if not isinstance(password, str) or not minimum <= len(password) <= 128:
        message = "Usa una contraseña inicial de entre 8 y 128 caracteres." if initial else "Usa una contraseña de entre 12 y 128 caracteres."
        raise AccessError(422, message)
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, maxmem=64*1024*1024)
    return f"scrypt${salt.hex()}${value.hex()}"


def verify_password(password, encoded):
    try:
        if not isinstance(password, str) or len(password) > 128:
            return False
        _, salt, expected = encoded.split("$")
        value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768,
                                r=8, p=1, maxmem=64*1024*1024)
        return hmac.compare_digest(value.hex(), expected)
    except (ValueError, TypeError):
        return False


def user_values(body):
    username = str(body.get("username", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    role = body.get("role")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._@-]{2,79}", username):
        raise AccessError(422, "El usuario debe tener 3–80 caracteres: letras, números, punto, guion o @.")
    if not 2 <= len(name) <= 120 or role not in ROLES:
        raise AccessError(422, "Indica un nombre de 2–120 caracteres y un rol válido.")
    return username, name, role


def require_manager(db, actor):
    row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
    if not row or row["role"] != "super-admin":
        raise AccessError(403, "No tienes permiso para realizar esta operación.")


def _initial_password():
    if "SGRS_INITIAL_USER_PASSWORD" not in os.environ:
        return None
    value = os.environ.get("SGRS_INITIAL_USER_PASSWORD", "")
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise AccessError(503, "La contraseña inicial configurada no cumple la política de seguridad.")
    return value


def _valid_pages(raw):
    if not isinstance(raw, list) or not all(isinstance(page, str) and page in AVAILABLE_PAGES for page in raw):
        raise AccessError(422, "Lista de páginas permitidas no válida.")
    return list(dict.fromkeys(raw))


def _actor_pages(actor):
    pages = parse_allowed_pages(actor["allowed_pages"], actor["role"])
    return pages, parse_allowed_submodules(actor["allowed_submodules"], pages)


def _access_values(body, actor, role, old=None):
    """Return pages, submodules and capabilities clamped to the actor's access."""
    actor_pages, actor_submodules = _actor_pages(actor)
    super_admin = actor["role"] == "super-admin"
    old_pages = parse_allowed_pages(old["allowed_pages"], old["role"]) if old else []
    old_submodules = parse_allowed_submodules(old["allowed_submodules"], old_pages) if old else []

    if old and "allowed_pages" not in body:
        pages = old_pages
    else:
        requested_pages = _valid_pages(body["allowed_pages"]) if "allowed_pages" in body else list(ROLE_PAGE_DEFAULTS.get(role, []))
        if super_admin:
            pages = requested_pages
        else:
            pages = list(dict.fromkeys(
                [page for page in requested_pages if page in actor_pages]
                + [page for page in old_pages if page not in actor_pages]
            ))

    if old and "allowed_submodules" not in body:
        submodules = parse_allowed_submodules(old["allowed_submodules"], pages)
    else:
        requested_submodules = (validate_submodules(body["allowed_submodules"],
                                                     _valid_pages(body["allowed_pages"]) if "allowed_pages" in body else pages)
                                if "allowed_submodules" in body else default_submodules(pages))
        if super_admin:
            submodules = requested_submodules
        else:
            submodules = list(dict.fromkeys(
                [item for item in requested_submodules if item in actor_submodules]
                + [item for item in old_submodules if item not in actor_submodules and item.split(":", 1)[0] in pages]
            ))
    submodules = parse_allowed_submodules(submodules, pages)

    actor_capabilities = row_capabilities(actor)
    old_capabilities = row_capabilities(old) if old else []
    if old and "capabilities" not in body:
        child_capabilities = old_capabilities
    else:
        requested_capabilities = actor_capabilities if "capabilities" not in body else parse_capabilities(body["capabilities"])
        if "capabilities" in body and not isinstance(body["capabilities"], list):
            raise AccessError(422, "La lista de permisos no es válida.")
        if super_admin:
            child_capabilities = list(dict.fromkeys(requested_capabilities))
        else:
            child_capabilities = list(dict.fromkeys(
                [capability for capability in old_capabilities if capability not in actor_capabilities]
                + [capability for capability in requested_capabilities if capability in actor_capabilities]
            ))
    return pages, submodules, child_capabilities


def _user_snapshot(row):
    pages = parse_allowed_pages(row["allowed_pages"], row["role"])
    return {
        "username": row["username"],
        "name": row["name"],
        "role": row["role"],
        "active": bool(row["active"]),
        "is_hidden": bool(row["is_hidden"]),
        "allowed_pages": pages,
        "allowed_submodules": parse_allowed_submodules(row["allowed_submodules"], pages),
        "capabilities": row_capabilities(row),
    }


def save_user(body, actor=None, bootstrap=False):
    username, name, role = user_values(body)
    user_id = body.get("id")
    password = body.get("password", "")
    with database(write=True) as db:
        actor_row = None
        if bootstrap:
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
                raise AccessError(409, "Ya existe una cuenta. Usa Usuarios con un super-admin.")
            user_id = None
            role = "super-admin"
            actor_role = "super-admin"
            actor_capabilities = capabilities(actor_role)
            hidden = False
            active = True
            allowed_pages = list(ROLE_PAGE_DEFAULTS[role])
            allowed_submodules = default_submodules(allowed_pages)
            child_capabilities = actor_capabilities
            encoded = password_hash(password)
            must_change = False
        else:
            actor_row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
            if not actor_row:
                raise AccessError(403, "No tienes permiso para realizar esta operación.")
            actor_role = actor_row["role"]
            actor_capabilities = row_capabilities(actor_row)
            if user_id:
                if "users.read" not in actor_capabilities or "users.edit" not in actor_capabilities:
                    raise AccessError(403, "No tienes permiso para editar usuarios.")
            elif "users.read" not in actor_capabilities or "users.create" not in actor_capabilities:
                raise AccessError(403, "No tienes permiso para crear usuarios.")
            if role not in ROLES or not can_create_role(actor_row, role):
                raise AccessError(403, "No puedes asignar un rol igual o superior al de tu cuenta.")
            if "is_hidden" in body and actor_role != "super-admin" and body.get("is_hidden") not in (False, 0):
                raise AccessError(403, "Solo un super-admin puede cambiar la visibilidad de una cuenta.")
            active = body.get("active", True)
            if active not in (True, False, 1, 0):
                raise AccessError(422, "El estado debe ser activo o suspendido.")
            active = bool(active)
            hidden = body.get("is_hidden", False)
            if not isinstance(hidden, bool):
                raise AccessError(422, "La visibilidad debe ser un valor booleano.")

            old = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone() if user_id else None
            if old:
                if old["is_hidden"] and actor_role != "super-admin":
                    raise AccessError(404, "No se encontró el usuario.")
                if not can_edit_target(actor_row, old):
                    raise AccessError(403, "Solo una cuenta de jerarquía superior puede editar este usuario.")
                if body.get("version") != old["version"]:
                    raise AccessError(409, "Otro administrador modificó este usuario. Cierra y vuelve a abrir su ficha.")
                hidden = body.get("is_hidden", bool(old["is_hidden"]))
                allowed_pages, allowed_submodules, child_capabilities = _access_values(body, actor_row, role, old)
                encoded = password_hash(password) if password else None
                must_change = bool(old["must_change_password"]) if not encoded else True
                if old["active"] and old["role"] == "super-admin" and (role != "super-admin" or not active):
                    count = db.execute("SELECT COUNT(*) FROM users WHERE role='super-admin' AND active=1").fetchone()[0]
                    if count <= 1:
                        raise AccessError(409, "Debe existir al menos un super-admin activo.")
            else:
                if user_id:
                    raise AccessError(404, "No se encontró el usuario.")
                if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 1000:
                    raise AccessError(409, "Esta instancia local admite hasta 1000 cuentas. Migra el directorio antes de ampliar el límite.")
                initial = _initial_password()
                if initial is None:
                    if not password:
                        raise AccessError(503, "La contraseña inicial del servidor no está configurada.")
                    encoded = password_hash(password)
                    must_change = False
                else:
                    encoded = password_hash(initial, initial=True)
                    must_change = True
                allowed_pages, allowed_submodules, child_capabilities = _access_values(body, actor_row, role)
            if hidden and actor_role != "super-admin":
                raise AccessError(403, "Solo un super-admin puede ocultar una cuenta.")

        if not isinstance(hidden, bool):
            raise AccessError(422, "La visibilidad debe ser un valor booleano.")
        try:
            if user_id:
                old = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                before = _user_snapshot(old)
                stored_pages = allowed_pages or (['__none__'] if role == 'super-admin' else [])
                db.execute("""UPDATE users SET username=?,name=?,role=?,active=?,password_hash=?,version=version+1,
                    allowed_pages=?,allowed_submodules=?,capabilities=?,must_change_password=?,is_hidden=? WHERE id=?""",
                           (username, name, role, int(active), encoded or old["password_hash"], json.dumps(stored_pages),
                            json.dumps(allowed_submodules), json.dumps(child_capabilities), int(must_change), int(hidden), user_id))
                updated = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                after = _user_snapshot(updated)
                audit(db, actor, "user.updated", user_id, {"before": before, "after": after})
                before_caps, after_caps = set(before["capabilities"]), set(after["capabilities"])
                granted = sorted(after_caps - before_caps)
                revoked = sorted(before_caps - after_caps)
                if granted:
                    audit(db, actor, "user.permissions.granted", user_id, {"capabilities": granted})
                if revoked:
                    audit(db, actor, "user.permissions.revoked", user_id, {"capabilities": revoked})
                if bool(before["is_hidden"]) != bool(after["is_hidden"]):
                    audit(db, actor, "user.hidden" if after["is_hidden"] else "user.unhidden", user_id)
                if encoded:
                    audit(db, actor, "user.password.reset", user_id)
                db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            else:
                user_id = secrets.token_hex(16)
                stored_pages = allowed_pages or (['__none__'] if role == 'super-admin' else [])
                db.execute("""INSERT INTO users
                    (id,username,name,role,active,password_hash,created_at,allowed_pages,allowed_submodules,
                     capabilities,must_change_password,is_hidden)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                           (user_id, username, name, role, int(active), encoded, int(time.time()), json.dumps(stored_pages),
                            json.dumps(allowed_submodules), json.dumps(child_capabilities), int(must_change), int(hidden)))
                audit(db, actor or "bootstrap-local", "user.created", user_id,
                      {"role": role, "capabilities": child_capabilities, "allowed_pages": allowed_pages})
        except sqlite3.IntegrityError:
            raise AccessError(409, "No se pudo guardar la cuenta. Revisa los datos o elige otro usuario.") from None
        stored = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return user_for_actor(stored, actor_row or actor_role, include_permissions=(bootstrap or actor_role == "super-admin" or can_edit_target(actor_row, stored)))


def change_password(actor, token_hash, body):
    password = body.get("password") if isinstance(body, dict) else None
    confirmation = body.get("password_confirmation") if isinstance(body, dict) else None
    if password != confirmation:
        raise AccessError(422, "Las contraseñas no coinciden.")
    encoded = password_hash(password)
    with database(write=True) as db:
        row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
        if not row:
            raise AccessError(401, "La sesión no es válida. Vuelve a iniciar sesión.")
        current_session = db.execute("SELECT csrf FROM sessions WHERE token_hash=? AND user_id=?", (token_hash, actor)).fetchone()
        if not current_session:
            raise AccessError(401, "La sesión no es válida. Vuelve a iniciar sesión.")
        if row["must_change_password"] and password == os.environ.get("SGRS_INITIAL_USER_PASSWORD"):
            raise AccessError(422, "Elige una contraseña distinta de la contraseña inicial.")
        db.execute("UPDATE users SET password_hash=?,must_change_password=0,version=version+1 WHERE id=?", (encoded, actor))
        db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (actor, token_hash))
        audit(db, actor, "user.password.changed", actor)
        fresh = db.execute("SELECT * FROM users WHERE id=?", (actor,)).fetchone()
        return session_identity(fresh, current_session["csrf"])


def delete_user(actor, body):
    target_id = body.get("id") if isinstance(body, dict) else None
    version = body.get("version") if isinstance(body, dict) else None
    with database(write=True) as db:
        actor_row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
        target = db.execute("SELECT * FROM users WHERE id=?", (target_id,)).fetchone()
        if not actor_row or "users.read" not in row_capabilities(actor_row) or "users.delete" not in row_capabilities(actor_row):
            raise AccessError(403, "No tienes permiso para eliminar usuarios.")
        if not target or (target["is_hidden"] and actor_row["role"] != "super-admin"):
            raise AccessError(404, "No se encontró el usuario.")
        if version != target["version"]:
            raise AccessError(409, "El usuario cambió. Recarga la lista antes de eliminarlo.")
        if not can_edit_target(actor_row, target):
            raise AccessError(403, "Solo una cuenta de jerarquía superior puede eliminar este usuario.")
        if target["role"] == "super-admin" and target["active"]:
            count = db.execute("SELECT COUNT(*) FROM users WHERE role='super-admin' AND active=1").fetchone()[0]
            if count <= 1:
                raise AccessError(409, "Debe existir al menos un super-admin activo.")
        # Remove the account's personal attribution from retained operational history.
        db.execute("UPDATE audit SET actor='usuario eliminado' WHERE actor=?", (target_id,))
        db.execute("UPDATE audit SET target='usuario eliminado' WHERE target=?", (target_id,))
        db.execute("UPDATE support_inventory_adjustments SET actor_id='usuario eliminado',actor_name='Usuario eliminado' WHERE actor_id=?", (target_id,))
        db.execute("UPDATE ap_map_positions SET updated_by='Usuario eliminado' WHERE updated_by=?", (target_id,))
        db.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))
        db.execute("DELETE FROM dashboard_preferences WHERE user_id=?", (target_id,))
        db.execute("DELETE FROM users WHERE id=?", (target_id,))
        audit(db, actor, "user.deleted", "usuario eliminado", {"role": target["role"]})
    return {"deleted": True}


def ensure_hidden_superadmin():
    initial = _initial_password()
    if initial is None:
        raise AccessError(503, "SGRS_INITIAL_USER_PASSWORD debe estar configurada para crear SuperAdmin.")
    with database(write=True) as db:
        row = db.execute("SELECT * FROM users WHERE username='super.admin'").fetchone()
        pages = list(ROLE_PAGE_DEFAULTS["super-admin"])
        submodules = default_submodules(pages)
        caps = capabilities("super-admin")
        if row:
            changed = row["role"] != "super-admin" or not row["active"] or not row["is_hidden"] or row_capabilities(row) != caps
            db.execute("""UPDATE users SET role='super-admin',active=1,is_hidden=1,allowed_pages=?,
                allowed_submodules=?,capabilities=?,version=version+? WHERE id=?""",
                       (json.dumps(pages), json.dumps(submodules), json.dumps(caps), int(changed), row["id"]))
            if changed:
                audit(db, "system", "user.superadmin.ensure", row["id"])
            return row["id"]
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 1000:
            raise AccessError(409, "Esta instancia local admite hasta 1000 cuentas.")
        user_id = secrets.token_hex(16)
        db.execute("""INSERT INTO users
            (id,username,name,role,active,password_hash,created_at,allowed_pages,allowed_submodules,
             capabilities,must_change_password,is_hidden)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (user_id, "super.admin", "SuperAdmin", "super-admin", 1, password_hash(initial, initial=True), int(time.time()),
                    json.dumps(pages), json.dumps(submodules), json.dumps(caps), 1, 1))
        audit(db, "system", "user.created", user_id, {"role": "super-admin", "hidden": True})
        return user_id


def login(body, address):
    username = str(body.get("username", "")).strip().lower()[:80]
    now = int(time.time())
    buckets = ["global", "ip:" + address, "user:" + hashlib.sha256(username.encode()).hexdigest()]
    with database(write=True) as db:
        db.execute("DELETE FROM attempts WHERE created_at<?", (now - 900,))
        for bucket, limit in zip(buckets, (250, 30, 10)):
            if db.execute("SELECT COUNT(*) FROM attempts WHERE bucket=?", (bucket,)).fetchone()[0] >= limit:
                raise AccessError(429, "Demasiados intentos. Espera 15 minutos antes de volver a entrar.")
        db.executemany("INSERT INTO attempts VALUES(?,?)", [(b, now) for b in buckets])
        row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    # Equal-cost verification for nonexistent accounts; never reveal account existence.
    dummy = "scrypt$" + "00" * 16 + "$" + "00" * 64
    valid = verify_password(body.get("password"), row["password_hash"] if row else dummy)
    if not row or not valid or not row["active"]:
        raise AccessError(401, "Usuario o contraseña incorrectos.")
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with database(write=True) as db:
        fresh = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
        if not fresh["active"] or fresh["version"] != row["version"]:
            raise AccessError(401, "La cuenta cambió. Vuelve a iniciar sesión.")
        db.execute("DELETE FROM sessions WHERE expires<? OR touched<?", (now, now-IDLE_SECONDS))
        db.execute("INSERT INTO sessions VALUES(?,?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), row["id"], csrf, now+SESSION_SECONDS, now))
        audit(db, row["id"], "session.login", row["id"])
        identity_row = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return token, session_identity(identity_row, csrf)


def session(cookie):
    try:
        cookies = SimpleCookie(cookie or "")
        token = cookies["sgrs_session"].value
    except (KeyError, ValueError, CookieError):
        return None
    if len(token) > 128:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = int(time.time())
    with database() as db:
        row = db.execute("SELECT users.*,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>? AND touched>? AND active=1", (token_hash, now, now-IDLE_SECONDS)).fetchone()
        if not row or row["role"] not in ROLES:
            return None
        db.execute("UPDATE sessions SET touched=? WHERE token_hash=?", (now, token_hash))
        return {**session_identity(row, row["csrf"]), "token_hash": token_hash}


def _principal_segments(values):
    if not isinstance(values, list) or len(values) > 200 or not all(isinstance(value, str) and 0 < len(value) <= 512 for value in values):
        raise AccessError(422, "La selección de segmentos no es válida.")
    return list(dict.fromkeys(values))


def dashboard_preferences(user_id):
    with database() as db:
        row = db.execute("SELECT principal_segments FROM dashboard_preferences WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        return {"principal_segments": None}
    try:
        selected = json.loads(row["principal_segments"])
    except (TypeError, ValueError):
        selected = []
    return {"principal_segments": _principal_segments(selected)}


def save_dashboard_preferences(user_id, principal_segments):
    selected = _principal_segments(principal_segments)
    with database(write=True) as db:
        if not db.execute("SELECT 1 FROM users WHERE id=? AND active=1", (user_id,)).fetchone():
            raise AccessError(401, "La sesión no es válida. Vuelve a iniciar sesión.")
        db.execute(
            "INSERT INTO dashboard_preferences(user_id,principal_segments,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET principal_segments=excluded.principal_segments,updated_at=excluded.updated_at",
            (user_id, json.dumps(selected, ensure_ascii=False, separators=(",", ":")), int(time.time())),
        )
    return {"principal_segments": selected}


def connection_default(service):
    if service == 'inventarios':
        try:
            configured = json.loads((PRIVATE / 'inventarios-connection.json').read_text())
        except (OSError, ValueError):
            configured = {}
        return {"id": service, "url": os.environ.get('INVENTARIOS_API_URL', configured.get('url', 'http://127.0.0.1:8002/api/v1')),
                "auth_mode": 'api-key', "username": '', "secret": os.environ.get('INVENTARIOS_API_KEY', configured.get('secret', '')),
                "version": 0, "updated_at": None}
    return {"id": service, "url": os.environ.get(f"{service.upper()}_API_URL", f"http://127.0.0.1:{8001 if service == 'forti' else 8000}/api/v1"),
            "auth_mode": "api-key", "username": "", "secret": os.environ.get(f"{service.upper()}_API_KEY", os.environ.get("APP_API_KEY", "")), "version": 0, "updated_at": None}


def connection(service, public=False):
    if service not in ("forti", "omni", "inventarios"):
        raise AccessError(404, "Integración no encontrada.")
    with database() as db:
        row = db.execute("SELECT * FROM connections WHERE id=?", (service,)).fetchone()
    value = dict(row) if row else connection_default(service)
    if public:
        value["has_secret"] = bool(value.pop("secret"))
    return value


def connection_values(service, body):
    old = connection(service)
    url = str(body.get("url", "")).strip().rstrip("/")
    if url.endswith("/health"):
        url = url[:-len("/health")]
    elif url.endswith("/system/health"):
        url = url[:-len("/system/health")]
    try:
        parsed = urlsplit(url)
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError()
    except ValueError:
        raise AccessError(422, "La URL no es válida.") from None
    if (len(url) > 500 or parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or any(c.isspace() or ord(c) < 32 for c in url) or "%" in url or "\\" in url
            or any(p in (".", "..") for p in parsed.path.split("/"))):
        raise AccessError(422, "Usa una URL HTTP(S) base, sin credenciales, parámetros ni fragmentos.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if address.is_link_local or address.is_multicast or address.is_unspecified:
            raise AccessError(422, "Ese destino no está permitido.")
        local = address.is_loopback
    except ValueError:
        local = parsed.hostname == "localhost"
    if parsed.scheme != "https" and not local:
        raise AccessError(422, "Usa HTTPS fuera de localhost para proteger la contraseña.")
    mode = body.get("auth_mode", "api-key")
    username = str(body.get("username", "")).strip()
    secret = body.get("secret", "")
    if mode not in ("api-key", "bearer", "basic") or not isinstance(secret, str) or len(secret) > 4096 or any(ord(c) < 32 or (mode != "basic" and ord(c) > 126) for c in secret):
        raise AccessError(422, "Selecciona una autenticación válida y una credencial sin saltos de línea.")
    if mode == "basic" and (not username or ":" in username or len(username) > 120 or any(ord(c) < 32 for c in username)):
        raise AccessError(422, "Indica un usuario válido para autenticación Basic.")
    if not secret:
        if (url, mode, username) != (old["url"], old["auth_mode"], old["username"]):
            raise AccessError(422, "Al cambiar el destino o la autenticación, vuelve a introducir la credencial.")
        secret = old["secret"]
    if not secret:
        raise AccessError(422, "Introduce la contraseña o clave de consulta.")
    return {"id": service, "url": url, "auth_mode": mode, "username": username, "secret": secret}


def save_connection(service, body, actor):
    value = connection_values(service, body)
    with database(write=True) as db:
        require_manager(db, actor)
        old = db.execute("SELECT version FROM connections WHERE id=?", (service,)).fetchone()
        version = old[0] if old else 0
        if body.get("version") != version:
            raise AccessError(409, "La conexión cambió. Recarga su configuración antes de guardar.")
        db.execute("INSERT INTO connections VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,auth_mode=excluded.auth_mode,username=excluded.username,secret=excluded.secret,version=excluded.version,updated_at=excluded.updated_at",
                   (service, value["url"], value["auth_mode"], value["username"], value["secret"], version+1, int(time.time())))
        audit(db, actor, "connection.updated", service)
    return connection(service, public=True)


def connection_headers(value):
    secret = value["secret"]
    if not secret:
        return {}
    if value["auth_mode"] == "bearer":
        return {"Authorization": f"Bearer {secret}"}
    if value["auth_mode"] == "basic":
        token = base64.b64encode(f"{value['username']}:{secret}".encode()).decode()
        return {"Authorization": f"Basic {token}"}
    return {"X-API-Key": secret}


# Device connection history tracking
from dashboard_device_history import (
    normalize_mac,
    format_device_type,
    is_device_online,
    record_device_presence,
    get_longest_connected_devices,
)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Aprovisionamiento local de SGRS")
    parser.add_argument("command", choices=["bootstrap"])
    parser.parse_args()
    try:
        username = input("Usuario del primer super-admin: ")
        name = input("Nombre completo: ")
        password = getpass.getpass("Contraseña (12–128 caracteres): ")
        if password != getpass.getpass("Repite la contraseña: "):
            raise AccessError(422, "Las contraseñas no coinciden.")
        save_user({"username": username, "name": name, "role": "super-admin", "password": password}, bootstrap=True)
        print("Super-admin creado. Ya puedes iniciar sesión en el dashboard.")
    except AccessError as exc:
        raise SystemExit(str(exc))
