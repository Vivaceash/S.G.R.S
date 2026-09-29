"""Same-origin HTTP boundary for the local dashboard (used by server.Handler)."""
import hmac
import json
import os
import re
import time
from urllib.parse import urlsplit
from integration_health import upstream_healthy
from dashboard_catalog import CATALOG
from dashboard_history import history
import dashboard_inventory as inventory

from dashboard_access import (AccessError, SESSION_SECONDS, database, session, login,
                              public_user, save_user, connection, connection_values,
                              save_connection, audit)


# Explicit read surface: adding an upstream route never grants access implicitly.
RESERVED_READ_PATHS = frozenset(
    "/api/forti/" + suffix for suffix in (
        "devices", "health", "network/dhcp-leases", "network/arp-table", "network/interfaces",
        "system/status", "system/resources", "system/firmware", "firewall/policies",
        "firewall/addresses", "firewall/address-groups", "vpn/ipsec", "vpn/ssl-sessions",
        "traffic/sessions", "traffic/destinations", "traffic/logs",
    )
) | frozenset(
    "/api/omni/" + suffix for suffix in (
        "employees", "company-properties", "catalogs/access-role-profiles", "catalogs/device-options",
        "catalogs/vlans", "monitoring/infrastructure-stats", "monitoring/devices",
        "monitoring/online-devices", "monitoring/topology", "monitoring/notifications",
        "system/health", "system/version",
    )
)
RESERVED_READ_DETAILS = (
    r"/api/forti/devices/[a-zA-Z0-9:.\-]{3,50}",
    r"/api/(?:forti/traffic|traffic)/ip/[0-9a-fA-F:.]{1,45}",
    r"/api/omni/employees/[a-zA-Z0-9._@\-]{1,64}",
    r"/api/omni/company-properties/[a-fA-F0-9:.\-]{12,24}",
    r"/api/omni/monitoring/devices/[0-9a-fA-F:.]{1,45}",
)


def reserved_read_allowed(path):
    return ".." not in path and (path in RESERVED_READ_PATHS or any(
        re.fullmatch(pattern, path) for pattern in RESERVED_READ_DETAILS))


class AccessRoutes:
    def _origins(self):
        # Explicit deployments must set the public HTTPS origin and use a reverse proxy.
        configured = os.environ.get("SGRS_PUBLIC_ORIGIN", "").rstrip("/")
        lan_origin = os.environ.get("SGRS_LAN_ORIGIN", "").rstrip("/")
        local = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
                 for port in (3000, 3001, 3002, 5173, 4173)}
        # El operador local conserva acceso por localhost; los teléfonos solo
        # pueden entrar por la IP LAN concreta emitida en el código QR.
        return local | ({configured} if configured else set()) | ({lan_origin} if lan_origin else set())

    def _boundary(self, mutation=False):
        origins = self._origins()
        if self.headers.get("Host") not in {urlsplit(origin).netloc for origin in origins}:
            raise AccessError(403, "Origen no permitido. Configura SGRS_PUBLIC_ORIGIN para publicar el dashboard.")
        origin = self.headers.get("Origin")
        if (mutation and origin not in origins) or (origin and origin not in origins):
            raise AccessError(403, "Esta solicitud debe realizarse desde el dashboard autorizado.")
        if mutation:
            if self.headers.get("Transfer-Encoding"):
                raise AccessError(400, "Formato de solicitud no admitido.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise AccessError(400, "Longitud de solicitud no válida.") from None
            if not 0 < length <= 15 * 1024 * 1024:
                raise AccessError(413, "La solicitud supera el tamaño permitido.")
            if self.headers.get_content_type() != "application/json":
                raise AccessError(415, "Se requiere contenido JSON.")

    def _body(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except (ValueError, UnicodeError):
            raise AccessError(400, "La solicitud no contiene un objeto JSON válido.") from None

    def _cookie(self, token, clear=False):
        secure = "; Secure" if os.environ.get("SGRS_PUBLIC_ORIGIN", "").startswith("https://") else ""
        self._session_cookie = f"sgrs_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else SESSION_SECONDS}{secure}"

    def _authorize(self, mutation=False):
        self.identity = session(self.headers.get("Cookie"))
        if not self.identity:
            raise AccessError(401, "Inicia sesión para acceder al sistema.")
        if mutation and not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.identity["csrf"]):
            raise AccessError(403, "La sesión cambió. Inicia sesión nuevamente antes de guardar.")

    def _manage(self):
        if "users.manage" not in self.identity["capabilities"]:
            raise AccessError(403, "No tienes permiso para acceder a esta sección.")

    def access_get(self):
        if not self.path.startswith("/api/"):
            return False
        try:
            self._boundary()
            path = urlsplit(self.path).path
            if path == "/api/auth/session":
                identity = session(self.headers.get("Cookie"))
                with database() as db:
                    setup = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
                self._send_json({k: v for k, v in identity.items() if k != "token_hash"} if identity else {"user": None, "setup_required": setup})
                return True
            if path == "/api/mobile-report":
                self.mobile_report_context(self.path)
                return True
            self._authorize()
            if path == '/api/inventory/catalog':
                result = inventory.catalog()
                if self.identity['user']['role'] == 'viewer':
                    result['observations'] = []
                    result['structure'] = {}
                self._send_json(result)
                return True
            if path == '/api/inventory/reconcile':
                self._send_json(inventory.live_reconciliation(self.inventory_fetch))
                return True
            if path.startswith('/api/inventory/documents/'):
                if 'inventory.export' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para descargar documentos de inventario.')
                raw, filename = inventory.source_download(path.rsplit('/', 1)[-1])
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return True
            if path == "/api/admin/history":
                self._manage()
                self._send_json(history())
                return True
            if path == "/api/admin/catalog":
                self._manage()
                self._send_json({"modules": CATALOG})
                return True
            if path == "/api/admin/users":
                self._manage()
                with database() as db:
                    users = [public_user(row) for row in db.execute("SELECT * FROM users ORDER BY created_at DESC,id")]
                self._send_json({"users": users})
                return True
            if path == "/api/admin/connections":
                self._manage()
                self._send_json({"connections": [connection(name, public=True) for name in ("forti", "omni")]})
                return True
            normal = {"/api/idfs", "/api/reports", "/api/ips", "/api/devices", "/api/devices/summary", "/api/health", "/api/ip", "/api/forti/network/dhcp-pools", "/api/altas/omnivista", "/api/aps/omnivista"}
            if path in normal:
                return False
            if path.startswith("/api/reports/evidence/"):
                if self.identity["user"]["role"] == "viewer":
                    raise AccessError(403, "La evidencia requiere un perfil operativo.")
                self.send_evidence(path.rsplit("/", 1)[-1], inline=urlsplit(self.path).query == "view=1")
                return True
            # Deny proxy authentication, arbitrary paths, encoded traversal and all non-GET operations.
            if self.identity["user"]["role"] == "super-admin" and reserved_read_allowed(path):
                return False
            raise AccessError(403, "No tienes permiso para consultar este recurso.")
        except AccessError as exc:
            self._send_json({"error": str(exc)}, exc.status)
        except Exception:
            self._send_json({"error": "No se pudo consultar el servicio de acceso."}, 503)
        return True

    def access_post(self):
        try:
            self._boundary(mutation=True)
            path = urlsplit(self.path).path
            if path == "/api/auth/login":
                token, identity = login(self._body(), self.client_address[0])
                self._cookie(token)
                self._send_json(identity)
                return True
            if path == "/api/auth/bootstrap":
                body = self._body()
                if not all(isinstance(body.get(key), str) for key in ("username", "name", "password", "password_confirmation")):
                    raise AccessError(422, "Completa usuario, nombre y contraseña.")
                if body["password"] != body["password_confirmation"]:
                    raise AccessError(422, "Las contraseñas no coinciden.")
                save_user({"username": body["username"], "name": body["name"], "role": "super-admin", "password": body["password"]}, bootstrap=True)
                token, identity = login(body, self.client_address[0])
                self._cookie(token)
                self._send_json(identity)
                return True
            if path == "/api/mobile-report":
                self.save_mobile_report(self._body(), self.client_address[0])
                return True
            self._authorize(mutation=True)
            actor = self.identity["user"]["id"]
            if path == '/api/reports/resolve':
                if 'idf.visits.write' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para resolver incidencias.')
                self.resolve_report(self._body())
                return True
            if path == '/api/inventory/asset':
                if 'inventory.write' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para modificar el inventario.')
                self._send_json(inventory.save_asset(self._body(), actor))
                return True
            if path == "/api/auth/logout":
                with database(write=True) as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (self.identity["token_hash"],))
                self._cookie("", clear=True)
                self._send_json({"status": "success"})
                return True
            if path == "/api/admin/users/save":
                self._manage()
                self._send_json({"user": save_user(self._body(), actor)})
                return True
            match = re.fullmatch(r"/api/admin/connections/(forti|omni)/(save|test)", path)
            if match:
                self._manage()
                service, operation = match.groups()
                body = self._body()
                if operation == "save":
                    self._send_json({"connection": save_connection(service, body, actor)})
                else:
                    value = connection_values(service, body)
                    # One intentional diagnostic, no retries and no remote mutations.
                    with database(write=True) as db:
                        recent = db.execute("SELECT COUNT(*) FROM audit WHERE actor=? AND action='connection.test' AND created_at>?", (actor, int(time.time())-60)).fetchone()[0]
                        if recent >= 6:
                            raise AccessError(429, "Espera un minuto antes de repetir la prueba.")
                        audit(db, actor, "connection.test", service)
                    started = time.monotonic()
                    code, payload, ctype = self.probe_connection(value)
                    valid_json = False
                    try:
                        parsed = json.loads(payload)
                        valid_json = isinstance(parsed, dict) and parsed.get("success") is not False and not parsed.get("error")
                    except (ValueError, UnicodeError):
                        pass
                    ok = valid_json and "json" in ctype.lower() and upstream_healthy(service, code, payload)
                    self._send_json({"ok": bool(ok), "http_status": code, "elapsed_ms": round((time.monotonic()-started)*1000),
                                     "message": "La API respondió a la consulta autenticada." if ok else "La API rechazó la credencial." if code in (401, 403) else "No se pudo confirmar la conexión. Revisa URL, TLS y disponibilidad de la API."})
                return True
            if path == "/api/reports":
                if "idf.visits.write" not in self.identity["capabilities"]:
                    raise AccessError(403, "El rol viewer solo puede consultar los reportes.")
                self.save_report(self._body())
                return True
            if path in ("/api/ips/update", "/api/idfs/device") and "inventory.write" in self.identity["capabilities"]:
                return False
            raise AccessError(403, "No tienes permiso para realizar esta operación.")
        except AccessError as exc:
            self._send_json({"error": str(exc)}, exc.status)
        except Exception:
            self._send_json({"error": "No se pudo completar la operación. Consulta el estado antes de repetirla."}, 503)
        return True

    def viewer_projection(self, data):
        """Minimize personal data and raw upstream objects for read-only accounts."""
        if getattr(self, "identity", None) and self.identity["user"]["role"] == "viewer":
            hidden = {"raw", "mac", "serial", "tech", "actor", "actor_id", "resolved_by", "username", "notes", "description", "evidence", "hostname", "user", "users"}
            def clean(value):
                if isinstance(value, dict):
                    return {k: clean(v) for k, v in value.items() if k not in hidden}
                if isinstance(value, list):
                    return [clean(v) for v in value]
                return value
            return clean(data)
        return data
