from datetime import datetime, timezone
from pathlib import Path
"""Same-origin HTTP boundary for the local dashboard (used by server.Handler)."""
from http.cookies import SimpleCookie
import hmac
import ipaddress
import json
import os
import re
import socket
import subprocess
import time
from urllib.parse import urlsplit, parse_qs
from integration_health import upstream_healthy
from dashboard_catalog import CATALOG
from dashboard_history import history
from dashboard_audit import audit_events
import dashboard_inventory as inventory
import dashboard_inventarios as inventories_api
from dashboard_device_history import get_longest_connected_devices

from dashboard_access import (AccessError, SESSION_SECONDS, PERSISTENT_SESSION_SECONDS, database, session, login,
                              list_users, project_hidden_actors, save_user, change_password, delete_user,
                              connection, connection_values,
                              save_connection, audit, dashboard_preferences, save_dashboard_preferences,
                              identity_pages, identity_submodules)


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


def lan_interface_addresses():
    """IPv4 interfaces and their directly connected LAN networks."""
    try:
        result = subprocess.run(["ip", "-j", "address", "show"], capture_output=True,
                                text=True, timeout=2, check=True)
        return [ipaddress.ip_interface(f"{address['local']}/{address.get('prefixlen', 32)}")
                for interface in json.loads(result.stdout)
                for address in interface.get("addr_info", [])
                if address.get("family") == "inet" and address.get("scope") == "global"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        return []


class AccessRoutes:
    def _lan_client_allowed(self, client_ip):
        """Allow HTTP sessions only from private clients or configured LAN CIDRs."""
        if client_ip.is_private or client_ip.is_loopback:
            return True
        if any(client_ip in interface.network for interface in lan_interface_addresses()):
            return True
        configured = os.environ.get("SGRS_LAN_CLIENT_CIDRS", "")
        for value in re.split(r"[\s,;]+", configured.strip()):
            if not value:
                continue
            try:
                if client_ip in ipaddress.ip_network(value, strict=False):
                    return True
            except ValueError:
                continue
        return False

    def _secure_transport(self):
        # Only a proxy on this machine may attest TLS. Origin is client input,
        # not evidence of encryption. The backend must remain on loopback.
        public = os.environ.get("SGRS_PUBLIC_ORIGIN", "").rstrip("/")
        return bool(public and urlsplit(public).scheme == "https"
                    and ipaddress.ip_address(self.client_address[0]).is_loopback
                    and self.headers.get("Host", "") == urlsplit(public).netloc
                    and self.headers.get("X-Forwarded-Proto", "") == "https")

    def _require_transport(self):
        if urlsplit(self.path).path == "/api/mobile-report":
            return  # Existing public QR flow; never accepts account credentials.
        if self._secure_transport():
            return
        if os.environ.get("SGRS_PUBLIC_ORIGIN"):
            raise AccessError(403, "Abre el dashboard mediante HTTPS para proteger las credenciales y la sesión.")

        try:
            client_ip = ipaddress.ip_address(self.client_address[0])
            client_ip = getattr(client_ip, 'ipv4_mapped', None) or client_ip
        except (ValueError, TypeError):
            client_ip = None

        if not client_ip:
            raise AccessError(403, "Abre el dashboard mediante HTTPS para proteger las credenciales y la sesión.")

        req_host = self.headers.get("Host", "")
        host = urlsplit("//" + req_host).hostname
        raw_origin = self.headers.get("Origin")
        if not raw_origin and self.headers.get("Referer"):
            ref = urlsplit(self.headers.get("Referer"))
            raw_origin = f"{ref.scheme}://{ref.netloc}"
        origin = urlsplit(raw_origin) if raw_origin else None

        # 1. Desarrollo local en loopback
        if (client_ip.is_loopback
                and host in ("localhost", "127.0.0.1", "::1")
                and (not origin or (origin.scheme == "http" and origin.hostname in ("localhost", "127.0.0.1", "::1")))):
            return

        # 2. Acceso LAN permitido desde redes privadas o CIDRs institucionales
        # explícitamente configurados, siempre con host/origen local autorizado.
        if self._lan_client_allowed(client_ip):
            origins = self._origins()
            lan_origins = {orig for orig in origins if orig != "*" and urlsplit(orig).hostname not in ("localhost", "127.0.0.1", "::1")}
            lan_hosts = {urlsplit(orig).netloc for orig in lan_origins}
            lan_hostnames = {urlsplit(orig).hostname for orig in lan_origins if urlsplit(orig).hostname}

            host_allowed = (req_host in lan_hosts) or (host in lan_hostnames)
            origin_allowed = (not origin) or (
                origin.scheme == "http" and (
                    raw_origin.rstrip("/") in origins
                    or origin.netloc in lan_hosts
                    or origin.hostname in lan_hostnames
                )
            )

            if host_allowed and origin_allowed:
                return

        raise AccessError(403, "Abre el dashboard mediante HTTPS para proteger las credenciales y la sesión.")

    def _origins(self):
        # Explicit deployments must set the public HTTPS origin and use a reverse proxy.
        configured = os.environ.get("SGRS_PUBLIC_ORIGIN", "").rstrip("/")
        lan_origin = os.environ.get("SGRS_LAN_ORIGIN", "").strip()
        local = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
                 for port in (3000, 3001, 3002, 5173, 4173)}
        origins = set(local)
        # Auto-include host LAN interfaces (Wi-Fi, Ethernet) for QR code mobile access
        try:
            host_ips = set()
            # DNS and the default route do not enumerate secondary LAN NICs.
            host_ips.update(str(interface.ip) for interface in lan_interface_addresses())
            try:
                _, _, ips = socket.gethostbyname_ex(socket.gethostname())
                host_ips.update(ips)
            except Exception:
                pass
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("10.255.255.255", 1))
                host_ips.add(s.getsockname()[0])
                s.close()
            except Exception:
                pass
            for ip in host_ips:
                if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                    origins.add(f"http://{ip}")
                    for port in (3000, 3001, 3002, 5173, 4173):
                        origins.add(f"http://{ip}:{port}")
        except Exception:
            pass
        if configured:
            origins.add(configured)
        if lan_origin:
            for item in re.split(r'[\s,]+', lan_origin):
                clean = item.strip().rstrip("/")
                if not clean:
                    continue
                if clean == "*":
                    continue
                origins.add(clean)
                parsed = urlsplit(clean)
                if parsed.hostname:
                    if parsed.port in (3000, 3001, 3002):
                        origins.add(f"{parsed.scheme}://{parsed.hostname}")
                        origins.add(f"{parsed.scheme}://{parsed.hostname}:3000")
                        origins.add(f"{parsed.scheme}://{parsed.hostname}:3001")
                        origins.add(f"{parsed.scheme}://{parsed.hostname}:3002")
                    elif not parsed.port and parsed.scheme in ("http", "https"):
                        origins.add(f"{clean}:3000")
                        origins.add(f"{clean}:3001")
                        origins.add(f"{clean}:3002")
        return origins

    def _boundary(self, mutation=False):
        origins = self._origins()
        if "*" not in origins:
            allowed_hosts = {urlsplit(origin).netloc for origin in origins if origin != "*"}
            req_host = self.headers.get("Host", "")
            if req_host not in allowed_hosts:
                raise AccessError(403, "Origen no permitido. Configura SGRS_PUBLIC_ORIGIN para publicar el dashboard.")
            origin = self.headers.get("Origin")
            if not origin and self.headers.get("Referer"):
                ref = urlsplit(self.headers.get("Referer"))
                origin = f"{ref.scheme}://{ref.netloc}"
            if (mutation and origin not in origins) or (origin and origin not in origins):
                raise AccessError(403, "Esta solicitud debe realizarse desde el dashboard autorizado.")
        self._require_transport()
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

    def _cookie(self, token, clear=False, persistent=False):
        # En conexiones HTTP LAN o desarrollo local sin proxy HTTPS, no exigir
        # '; Secure' para que los navegadores no descarten la cookie sgrs_session.
        secure = "; Secure" if self._secure_transport() else ""
        self._session_cookie = f"sgrs_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else PERSISTENT_SESSION_SECONDS if persistent else SESSION_SECONDS}{secure}"

    def _renew_session_cookie(self, identity):
        if identity and identity["user"].get("keep_session"):
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            self._cookie(cookies["sgrs_session"].value, persistent=True)

    def _authorize(self, mutation=False):
        self.identity = session(self.headers.get("Cookie"))
        if not self.identity:
            raise AccessError(401, "Inicia sesión para acceder al sistema.")
        self._renew_session_cookie(self.identity)
        if mutation and not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.identity["csrf"]):
            raise AccessError(403, "La sesión cambió. Inicia sesión nuevamente antes de guardar.")
        if self.identity.get("must_change_password") and urlsplit(self.path).path not in (
                "/api/auth/password/change", "/api/auth/logout"):
            raise AccessError(428, "Cambia tu contraseña inicial antes de continuar.")

    def _manage(self):
        if self.identity["user"]["role"] != "super-admin" or "integrations.manage" not in self.identity["capabilities"]:
            raise AccessError(403, "No tienes permiso para acceder a esta sección.")

    def _require_pages(self, pages, capability):
        if capability not in self.identity["capabilities"] or not set(pages).intersection(identity_pages(self.identity)):
            raise AccessError(403, "No tienes permiso para consultar o modificar este recurso.")

    def _require_submodule(self, page, tab, capability):
        self._require_pages((page,), capability)
        if f'{page}:{tab}' not in identity_submodules(self.identity):
            raise AccessError(403, 'No tienes permiso para acceder a esta pestaña.')

    def _require_idf_read(self, path):
        views = parse_qs(urlsplit(self.path).query, keep_blank_values=True).get("view", ["individual"])
        if len(views) != 1 or views[0] not in ("general", "individual"):
            raise AccessError(422, "Vista IDF no válida.")
        view = views[0]
        self._require_pages(("bitacora-idf" if view == "general" else "idf",),
                            "activity.read" if path == "/api/reports" or view == "general" else "idf.read")
        if path == '/api/reports' and view == 'individual':
            self._require_submodule('idf', 'activity', 'activity.read')
        return view

    def access_get(self):
        if not self.path.startswith("/api/"):
            return False
        try:
            self._boundary()
            path = urlsplit(self.path).path
            if path == "/api/auth/session":
                identity = session(self.headers.get("Cookie"))
                self._renew_session_cookie(identity)
                with database() as db:
                    setup = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
                self._send_json({k: v for k, v in identity.items() if k != "token_hash"} if identity else {"user": None, "setup_required": setup, "web_bootstrap_allowed": os.environ.get("SGRS_ALLOW_WEB_BOOTSTRAP") == "1" and self.client_address[0] in ("127.0.0.1", "::1")})
                return True
            if path == "/api/mobile-report":
                self.mobile_report_context(self.path)
                return True
            self._authorize()
            if path.startswith('/api/support/movements/evidence/'):
                self._require_submodule('soporte', 'log', 'activity.read')
                self.send_evidence(path.rsplit('/', 1)[-1], inline=urlsplit(self.path).query == 'view=1', kind='support')
                return True
            if path == '/api/support/idfs':
                self._require_pages(('soporte',), 'idf.read')
                self._send_json({'idfs': self.support_idfs()})
                return True
            if path == '/api/support/movements':
                self._require_submodule('soporte', 'log', 'activity.read')
                self._send_json({'movements': self.support_movements()})
                return True
            if path == '/api/support/inventory':
                self._require_pages(('soporte',), 'inventory.read')
                if not {'soporte:inventory', 'soporte:log'}.intersection(identity_submodules(self.identity)):
                    raise AccessError(403, 'No tienes permiso para consultar el inventario de soporte.')
                with database() as db:
                    items = [dict(row) for row in db.execute(
                        'SELECT * FROM support_inventory WHERE idf_id=? ORDER BY source_number', ('idf-3',))]
                self._send_json({'idf_id': 'idf-3', 'items': items})
                return True
            if path in ("/api/idfs", "/api/reports"):
                self.idf_read_view = self._require_idf_read(path)
                return False
            if path.startswith(("/api/inventory/", "/api/inventarios/")):
                self._require_pages(("idf", "aps", "cctv"), "inventory.read")
            if path == "/api/dashboard/preferences":
                self._send_json(dashboard_preferences(self.identity["user"]["id"]))
                return True
            if path.startswith('/api/inventarios/'):
                if 'inventory.read' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para consultar inventarios.')
                suffix = path[len('/api/inventarios'):]
                if suffix == '/cctv/catalog':
                    self._send_json(inventories_api.catalog())
                elif re.fullmatch(r'/reconciliation/jobs/[a-f0-9-]{36}', suffix):
                    self._send_json(inventories_api.request(suffix))
                else:
                    raise AccessError(404, 'Ruta de inventarios no disponible.')
                return True
            if path == '/api/inventory/catalog':
                permitted = set(identity_submodules(self.identity))
                if not permitted.intersection({'idf:inventory', 'aps:documentary', 'aps:map', 'cctv:updated', 'cctv:original'}):
                    raise AccessError(403, 'No tienes permiso para consultar el catálogo documental.')
                result = inventory.catalog()
                datasets = {'idf': 'idf:inventory', 'ap': 'aps:documentary', 'cctv': 'cctv:updated', 'cctv_original': 'cctv:original'}
                result['assets'] = [asset for asset in result.get('assets', []) if datasets.get(asset.get('dataset')) in permitted or (asset.get('dataset') == 'ap' and 'aps:map' in permitted)]
                if self.identity['user']['role'] == 'viewer':
                    result['observations'] = []
                    result['structure'] = {}
                self._send_json(result)
                return True
            if path == '/api/inventory/reconcile':
                self._require_pages(('idf', 'aps', 'cctv'), 'inventory.write')
                if inventories_api.active():
                    actor = self.identity.get('user', {}).get('id')
                    self._send_json(inventories_api.reconcile(actor))
                else:
                    self._send_json(inventory.live_reconciliation(self.inventory_fetch))
                return True
            if path == '/api/aps/map':
                self._require_submodule('aps', 'map', 'inventory.read')
                self._send_json(inventory.ap_map_positions())
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
                self._send_json({"users": list_users(self.identity["user"]["id"])})
                return True
            if path == "/api/admin/connections":
                self._manage()
                self._send_json({"connections": [connection(name, public=True) for name in ("forti", "omni", "inventarios")]})
                return True
            if path == "/api/audit":
                self._require_pages(("bitacora",), "activity.read")
                reports_file, idfs_file, lock = self.report_context()
                with lock:
                    events = audit_events(reports_file, idfs_file)
                self._send_json({"events": events})
                return True
            if path == "/api/support/longest-connected":
                self._require_submodule('soporte', 'live', 'dashboard.read')
                if self.identity["user"]["role"] not in ("soporte", "admin", "super-admin"):
                    raise AccessError(403, "No tienes permiso para acceder a esta sección.")
                query_params = parse_qs(urlsplit(self.path).query)
                dtype = query_params.get("type", ["Computadora"])[0]
                limit_param = query_params.get("limit", ["50"])[0]
                try:
                    limit = int(limit_param)
                except (ValueError, TypeError):
                    limit = 50
                online_param = query_params.get("online_only", [None])[0]
                only_online = online_param in ("1", "true", "True") if online_param is not None else False
                devices = get_longest_connected_devices(device_type=dtype, limit=limit, only_online=only_online)
                self._send_json(devices)
                return True
            normal = {"/api/idfs", "/api/reports", "/api/ips", "/api/devices", "/api/devices/summary", "/api/devices/export", "/api/health", "/api/ip", "/api/networks", "/api/forti/network/dhcp-pools", "/api/forti/network/dhcp-leases", "/api/altas/omnivista", "/api/aps/omnivista"}
            if path in normal or path == '/api/devices/omnivista':
                if path == '/api/aps/omnivista':
                    self._require_submodule('aps', 'live', 'inventory.read')
                return False
            if path.startswith("/api/reports/evidence/"):
                self._require_pages(("idf", "bitacora-idf"), "activity.read")
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
                self._cookie(token, persistent=identity["user"].get("keep_session", False))
                self._send_json(identity)
                return True
            if path == "/api/auth/bootstrap":
                if os.environ.get("SGRS_ALLOW_WEB_BOOTSTRAP") != "1" or self.client_address[0] not in ("127.0.0.1", "::1"):
                    raise AccessError(403, "La cuenta inicial debe crearse desde la consola del servidor.")
                body = self._body()
                if not all(isinstance(body.get(key), str) for key in ("username", "name", "password", "password_confirmation")):
                    raise AccessError(422, "Completa usuario, nombre y contraseña.")
                if body["password"] != body["password_confirmation"]:
                    raise AccessError(422, "Las contraseñas no coinciden.")
                save_user({"username": body["username"], "name": body["name"], "role": "super-admin", "password": body["password"]}, bootstrap=True)
                token, identity = login(body, self.client_address[0])
                self._cookie(token, persistent=identity["user"].get("keep_session", False))
                self._send_json(identity)
                return True
            if path == "/api/mobile-report":
                self.save_mobile_report(self._body(), self.client_address[0])
                return True
            self._authorize(mutation=True)
            if path == "/api/auth/password/change":
                self._send_json(change_password(self.identity["user"]["id"], self.identity["token_hash"], self._body()))
                return True
            if path == '/api/support/inventory/quantity':
                self._require_submodule('soporte', 'inventory', 'inventory.write')
                body = self._body()
                item_id, quantity, version = body.get('item_id'), body.get('quantity'), body.get('version')
                reason = str(body.get('reason') or '').strip()
                if not isinstance(item_id, str) or not isinstance(quantity, int) or isinstance(quantity, bool) or not 0 <= quantity <= 1000000 or not isinstance(version, int) or not reason or len(reason) > 500:
                    raise AccessError(422, 'Indica la cantidad, versión y motivo de la corrección.')
                with database(write=True) as db:
                    item = db.execute('SELECT * FROM support_inventory WHERE id=? AND idf_id=?', (item_id, 'idf-3')).fetchone()
                    if not item:
                        raise AccessError(404, 'El artículo no existe en el inventario IDF 3.')
                    if item['version'] != version:
                        raise AccessError(409, 'La cantidad cambió. Actualiza el inventario antes de modificarla.')
                    db.execute('UPDATE support_inventory SET quantity=?, version=version+1 WHERE id=?', (quantity, item_id))
                    db.execute('''INSERT INTO support_inventory_adjustments
                        (inventory_id,before_quantity,after_quantity,delta,reason,actor_id,actor_name,created_at)
                        VALUES (?,?,?,?,?,?,?,?)''', (item_id, item['quantity'], quantity, quantity-item['quantity'],
                        reason, self.identity['user']['id'], self.identity['user']['name'], datetime.now(timezone.utc).isoformat()))
                    audit(db, self.identity['user']['id'], 'support.inventory.corrected', item_id)
                    updated = dict(db.execute('SELECT * FROM support_inventory WHERE id=?', (item_id,)).fetchone())
                self._send_json({'status': 'success', 'item': updated})
                return True
            if path == '/api/altas/annotation':
                if self.identity['user']['role'] != 'super-admin':
                    raise AccessError(403, 'Solo un super-admin puede organizar las cuentas OmniVista.')
                body = self._body()
                username = body.get('username')
                hidden = body.get('is_hidden', False)
                category = body.get('category', '')
                comment = body.get('comment', '')
                if not isinstance(username, str) or not username.strip() or len(username) > 160:
                    raise AccessError(422, 'La cuenta OmniVista no es válida.')
                if not isinstance(hidden, bool) or not isinstance(category, str) or len(category) > 80 or not isinstance(comment, str) or len(comment) > 2000:
                    raise AccessError(422, 'Revisa la categoría y el comentario (máximo 80 y 2000 caracteres).')
                username = username.strip()
                category, comment = category.strip(), comment.strip()
                with database(write=True) as db:
                    db.execute('''INSERT INTO altas_account_annotations(username,is_hidden,category,comment,updated_at,updated_by)
                        VALUES(?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET
                        is_hidden=excluded.is_hidden,category=excluded.category,comment=excluded.comment,
                        updated_at=excluded.updated_at,updated_by=excluded.updated_by''',
                        (username, int(hidden), category, comment, int(time.time()), self.identity['user']['id']))
                    audit(db, self.identity['user']['id'], 'altas.account.annotated', username,
                          {'hidden': hidden, 'category': category, 'comment_updated': bool(comment)})
                self._send_json({'success': True, 'annotation': {'is_hidden': hidden, 'category': category, 'comment': comment}})
                return True
            if path == '/api/support/movements':
                self._require_submodule('soporte', 'log', 'activity.read')
                if self.identity['user']['role'] != 'soporte':
                    raise AccessError(403, 'Solo una cuenta de soporte puede registrar retiros.')
                self.save_support_movement(self._body())
                return True
            actor = self.identity["user"]["id"]
            if path.startswith(("/api/inventory/", "/api/inventarios/")):
                self._require_pages(("idf", "aps", "cctv"), "inventory.read")
            if path == "/api/dashboard/preferences":
                self._send_json(save_dashboard_preferences(actor, self._body().get("principal_segments")))
                return True
            if path == '/api/inventarios/reconciliation/jobs':
                if 'inventory.read' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para consultar inventarios.')
                self._body()
                self._send_json(inventories_api.request('/reconciliation/jobs', 'POST', {}, actor), 202)
                return True
            if path == '/api/inventarios/cctv/asset':
                if 'inventory.write' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para modificar el inventario.')
                if not inventories_api.active():
                    raise AccessError(409, 'Activa la migración antes de editar CCTV desde Inventarios.')
                self._send_json(inventories_api.save(self._body(), actor))
                return True
            if path == '/api/reports/resolve':
                self._require_pages(("idf",), "idf.visits.write")
                self.resolve_report(self._body())
                return True
            if path == '/api/inventory/asset':
                self._require_pages(("idf", "aps", "cctv"), "inventory.write")
                self._send_json(inventory.save_asset(self._body(), actor))
                return True
            if path == '/api/aps/map/save':
                self._require_submodule('aps', 'map', 'inventory.write')
                if 'inventory.write' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para ubicar puntos de acceso en el plano.')
                self._send_json(inventory.save_ap_map_position(self._body(), actor))
                return True
            if path == '/api/aps/map/remove':
                self._require_submodule('aps', 'map', 'inventory.write')
                if 'inventory.write' not in self.identity['capabilities']:
                    raise AccessError(403, 'No tienes permiso para retirar puntos de acceso del plano.')
                self._send_json(inventory.remove_ap_map_position(self._body(), actor))
                return True
            if path == "/api/auth/logout":
                with database(write=True) as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (self.identity["token_hash"],))
                self._cookie("", clear=True)
                self._send_json({"status": "success"})
                return True
            if path == "/api/admin/users/save":
                body = self._body()
                preserve_session = self.identity['token_hash'] if body.get('id') == actor else None
                self._send_json({"user": save_user(body, actor, preserve_session=preserve_session)})
                return True
            if path == "/api/admin/users/delete":
                self._send_json(delete_user(actor, self._body()))
                return True
            match = re.fullmatch(r"/api/admin/connections/(forti|omni|inventarios)/(save|test)", path)
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
                self._require_pages(("idf",), "idf.visits.write")
                self.save_report(self._body())
                return True
            if path in ("/api/ips/update", "/api/idfs/device") and "inventory.write" in self.identity["capabilities"]:
                if path == "/api/idfs/device":
                    self._require_pages(("idf",), "inventory.write")
                return False
            if path == "/api/altas/concession":
                self._require_pages(("altas",), "inventory.write")
                return False
            raise AccessError(403, "No tienes permiso para realizar esta operación.")
        except AccessError as exc:
            self._send_json({"error": str(exc)}, exc.status)
        except Exception:
            self._send_json({"error": "No se pudo completar la operación. Consulta el estado antes de repetirla."}, 503)
        return True

    def viewer_projection(self, data):
        """Minimize personal data and raw upstream objects for read-only accounts.

        The 'soporte' role must NOT have MAC, serial, IP, manufacturer, or diagnostic
        fields redacted, as it requires full technical specs for computers and printers.
        """
        identity = getattr(self, "identity", None)
        if identity and identity["user"]["role"] != "super-admin":
            data = project_hidden_actors(data)
            if isinstance(data, dict) and isinstance(data.get('data'), dict) and isinstance(data['data'].get('users'), list):
                projected = []
                for account in data['data']['users']:
                    if not isinstance(account, dict):
                        continue
                    annotation = account.get('adminAnnotation')
                    if isinstance(annotation, dict) and annotation.get('is_hidden'):
                        continue
                    projected.append({key: value for key, value in account.items() if key not in ('adminAnnotation', 'adminCategory')})
                data = {**data, 'data': {**data['data'], 'users': projected}}
        if identity and identity["user"]["role"] == "viewer":
            hidden = {"raw", "mac", "serial", "tech", "actor", "actor_id", "resolved_by", "username", "notes", "description", "evidence", "hostname", "user", "users"}
            def clean(value):
                if isinstance(value, dict):
                    return {k: clean(v) for k, v in value.items() if k not in hidden}
                if isinstance(value, list):
                    return [clean(v) for v in value]
                return value
            return clean(data)
        return data
