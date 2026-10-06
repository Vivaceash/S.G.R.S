"""Local dashboard identity and integration configuration. No external dependencies.

Provision the first account with: python dashboard_access.py bootstrap
This module never provisions default credentials or performs network calls on import.
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
MANAGE = ["users.manage", "integrations.manage", "traffic.read"]
SESSION_SECONDS = 8 * 3600
IDLE_SECONDS = 30 * 60

AVAILABLE_PAGES = (
    "resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf",
    "aps", "cctv", "altas", "soporte", "usuarios", "conexiones"
)

ROLE_PAGE_DEFAULTS = {
    "soporte": ["soporte"],
    "admin": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "aps", "cctv", "altas", "usuarios"],
    "super-admin": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "aps", "cctv", "altas", "soporte", "usuarios", "conexiones"],
    "viewer": ["resumen", "dispositivos", "disponibilidad", "gestion-meztli", "bitacora", "idf", "aps", "cctv", "altas"],
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
        return READ + OPERATE + MANAGE
    if role == "admin":
        return READ + OPERATE
    if role in ("viewer", "soporte"):
        return READ
    return []


def visible_roles(role):
    """Return assignable roles according to hierarchy: super-admin sees all 3, admin sees soporte and admin."""
    if role == "super-admin":
        return [ROLE_CATALOG["soporte"], ROLE_CATALOG["admin"], ROLE_CATALOG["super-admin"]]
    if role == "admin":
        return [ROLE_CATALOG["soporte"], ROLE_CATALOG["admin"]]
    return []


def parse_allowed_pages(raw_pages, role):
    if isinstance(raw_pages, str):
        try:
            pages = json.loads(raw_pages)
        except Exception:
            pages = []
    elif isinstance(raw_pages, (list, tuple)):
        pages = list(raw_pages)
    else:
        pages = []
    valid = [p for p in pages if p in AVAILABLE_PAGES]
    return valid if valid else list(ROLE_PAGE_DEFAULTS.get(role, []))


def session_identity(row, csrf):
    user = public_user(row)
    return {
        "user": user,
        "csrf": csrf,
        "capabilities": capabilities(row["role"]),
        "roles": visible_roles(row["role"]),
        "allowed_pages": user["allowed_pages"],
    }


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
            allowed_pages TEXT NOT NULL DEFAULT '[]');
          CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
            expires INTEGER NOT NULL, touched INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY, url TEXT NOT NULL, auth_mode TEXT NOT NULL,
            username TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '',
            version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS attempts (bucket TEXT NOT NULL, created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
            target TEXT NOT NULL, created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS metric_samples (
            sampled_at INTEGER PRIMARY KEY, metrics TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS inventory_edits (
            asset_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
            fields TEXT NOT NULL, updated_at TEXT NOT NULL);
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
        if "allowed_pages" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN allowed_pages TEXT NOT NULL DEFAULT '[]'")
        dh_cols = [r[1] for r in db.execute("PRAGMA table_info(device_connection_history)").fetchall()]
        if "serial" not in dh_cols and dh_cols:
            db.execute("ALTER TABLE device_connection_history ADD COLUMN serial TEXT")
        if write:
            db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def public_user(row):
    user = {k: row[k] for k in ("id", "username", "name", "role", "active", "version", "created_at")}
    raw_pages = row.get("allowed_pages") if hasattr(row, "get") else (row["allowed_pages"] if "allowed_pages" in row.keys() else None)
    user["allowed_pages"] = parse_allowed_pages(raw_pages, row["role"])
    return user


def audit(db, actor, action, target):
    db.execute("INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)",
               (actor, action, target, int(time.time())))


def password_hash(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise AccessError(422, "Usa una contraseña de entre 12 y 128 caracteres.")
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


def save_user(body, actor=None, bootstrap=False):
    username, name, role = user_values(body)
    password = body.get("password", "")
    encoded = password_hash(password) if password else None
    user_id = body.get("id")
    with database(write=True) as db:
        if bootstrap:
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
                raise AccessError(409, "Ya existe una cuenta. Usa Usuarios con un super-admin.")
            role = "super-admin"
            allowed_pages = list(ROLE_PAGE_DEFAULTS["super-admin"])
        else:
            actor_row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (actor,)).fetchone()
            if not actor_row or actor_row["role"] not in ("admin", "super-admin"):
                raise AccessError(403, "No tienes permiso para realizar esta operación.")
            actor_role = actor_row["role"]
            if actor_role == "admin" and role not in ("soporte", "admin"):
                raise AccessError(403, "Los administradores solo pueden asignar roles de soporte o administrador.")

        active = body.get("active", True)
        if not isinstance(active, bool):
            raise AccessError(422, "El estado debe ser activo o suspendido.")
        try:
            if user_id:
                old = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                if not old:
                    raise AccessError(404, "No se encontró el usuario.")
                if body.get("version") != old["version"]:
                    raise AccessError(409, "Otro administrador modificó este usuario. Cierra y vuelve a abrir su ficha.")
                if not bootstrap:
                    if actor_role == "admin":
                        if old["role"] == "super-admin":
                            raise AccessError(403, "Los administradores no pueden modificar una cuenta de super-admin.")
                        old_raw = old.get("allowed_pages") if hasattr(old, "get") else (old["allowed_pages"] if "allowed_pages" in old.keys() else None)
                        allowed_pages = parse_allowed_pages(old_raw, old["role"])
                    elif actor_role == "super-admin":
                        if "allowed_pages" in body:
                            raw_pages = body["allowed_pages"]
                            if not isinstance(raw_pages, list) or not all(isinstance(p, str) and p in AVAILABLE_PAGES for p in raw_pages):
                                raise AccessError(422, "Lista de páginas permitidas no válida.")
                            allowed_pages = list(dict.fromkeys(raw_pages))
                        else:
                            old_raw = old.get("allowed_pages") if hasattr(old, "get") else (old["allowed_pages"] if "allowed_pages" in old.keys() else None)
                            allowed_pages = parse_allowed_pages(old_raw, role)
                if user_id == actor and (role != old["role"] or not active):
                    raise AccessError(409, "No puedes cambiar tu propio rol ni suspender tu cuenta.")
                if old["active"] and old["role"] == "super-admin" and (role != "super-admin" or not active):
                    count = db.execute("SELECT COUNT(*) FROM users WHERE role='super-admin' AND active=1").fetchone()[0]
                    if count <= 1:
                        raise AccessError(409, "Debe existir al menos un super-admin activo.")
                db.execute("UPDATE users SET username=?,name=?,role=?,active=?,password_hash=?,version=version+1,allowed_pages=? WHERE id=?",
                           (username, name, role, int(active), encoded or old["password_hash"], json.dumps(allowed_pages), user_id))
                old_pages_raw = old.get("allowed_pages") if hasattr(old, "get") else (old["allowed_pages"] if "allowed_pages" in old.keys() else None)
                if role != old["role"] or not active or encoded or username != old["username"] or json.dumps(allowed_pages) != str(old_pages_raw):
                    db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            else:
                if not encoded:
                    raise AccessError(422, "Define una contraseña para la cuenta nueva.")
                if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 1000:
                    raise AccessError(409, "Esta instancia local admite hasta 1000 cuentas. Migra el directorio antes de ampliar el límite.")
                if not bootstrap:
                    if actor_role == "admin":
                        allowed_pages = list(ROLE_PAGE_DEFAULTS.get(role, []))
                    elif actor_role == "super-admin":
                        if "allowed_pages" in body:
                            raw_pages = body["allowed_pages"]
                            if not isinstance(raw_pages, list) or not all(isinstance(p, str) and p in AVAILABLE_PAGES for p in raw_pages):
                                raise AccessError(422, "Lista de páginas permitidas no válida.")
                            allowed_pages = list(dict.fromkeys(raw_pages))
                        else:
                            allowed_pages = list(ROLE_PAGE_DEFAULTS.get(role, []))
                user_id = secrets.token_hex(16)
                db.execute("INSERT INTO users(id,username,name,role,active,password_hash,created_at,allowed_pages) VALUES(?,?,?,?,?,?,?,?)",
                           (user_id, username, name, role, int(active), encoded, int(time.time()), json.dumps(allowed_pages)))
        except sqlite3.IntegrityError:
            raise AccessError(409, "Ese nombre de usuario ya está registrado.") from None
        audit(db, actor or "bootstrap-local", "user.updated" if body.get("id") else "user.created", user_id)
        return public_user(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())


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
    return token, session_identity(row, csrf)


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


def connection_default(service):
    return {"id": service, "url": os.environ.get(f"{service.upper()}_API_URL", f"http://127.0.0.1:{8001 if service == 'forti' else 8000}/api/v1"),
            "auth_mode": "api-key", "username": "", "secret": os.environ.get(f"{service.upper()}_API_KEY", os.environ.get("APP_API_KEY", "")), "version": 0, "updated_at": None}


def connection(service, public=False):
    if service not in ("forti", "omni"):
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
