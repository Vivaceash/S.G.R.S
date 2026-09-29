import http.server
import socketserver
import json
import os
import socket
import threading
import time
import urllib.request
import urllib.error
import http.client
import ipaddress
import re
import ssl
import unicodedata
import csv
import io
from urllib.parse import urlsplit, parse_qs
from dashboard_access import connection, connection_headers, AccessError
from dashboard_routes import AccessRoutes
from dashboard_reports import ReportRoutes, report_key, tagged_reports
from integration_health import upstream_healthy
from dashboard_history import start_collector
from dashboard_inventory import cabinets_with_documentary
from dashboard_device_history import record_device_presence, normalize_mac, format_device_type

# Lock global para proteger lecturas/escrituras concurrentes a archivos JSON
_file_lock = threading.Lock()

PORT = int(os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT", 3000))
# React's build is the only public directory; source and legacy screens are not served.
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Dashboard", "dist")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

FORTI_API_URL = os.environ.get("FORTI_API_URL", "http://127.0.0.1:8001/api/v1")
OMNI_API_URL = os.environ.get("OMNI_API_URL", "http://127.0.0.1:8000/api/v1")

REPORTS_FILE = os.path.join(DATA_DIR, "reports.json")
IDFS_FILE = os.path.join(DATA_DIR, "idfs.json")
IPS_FILE = os.path.join(DATA_DIR, "ips.json")
DEVICES_FILE = os.path.join(DATA_DIR, "devices.json")

# Asegurar que el directorio de datos y archivos base existan
os.makedirs(DATA_DIR, exist_ok=True)
for fpath, default_val in [
    (REPORTS_FILE, {}),
    (IDFS_FILE, []),
    (IPS_FILE, []),
    (DEVICES_FILE, [])
]:
    if not os.path.exists(fpath):
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(default_val, f, indent=2, ensure_ascii=False)


def _configured_request(config, suffix, timeout=4.0):
    """GET only; TLS verified, DNS address pinned, redirects never followed."""
    transport = None
    try:
        parsed = urlsplit(config["url"])
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid URL")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        for item in addresses:
            ip = ipaddress.ip_address(item[4][0])
            ip = getattr(ip, 'ipv4_mapped', None) or ip
            if ip.is_link_local or ip.is_multicast or ip.is_unspecified or (parsed.scheme == "http" and not ip.is_loopback):
                raise ValueError("Blocked address")
        def _connect_pinned(target, timeout=timeout, source_address=None):
            last_err = None
            for item in addresses:
                candidate_ip = item[4][0]
                try:
                    return socket.create_connection((candidate_ip, port), timeout, source_address)
                except OSError as err:
                    last_err = err
            if last_err:
                raise last_err
            raise OSError(f"No valid address to connect for {parsed.hostname}")

        transport = (http.client.HTTPSConnection(parsed.hostname, port, timeout=timeout, context=ssl.create_default_context())
                     if parsed.scheme == "https" else http.client.HTTPConnection(parsed.hostname, port, timeout=timeout))
        # Pin the checked IP while preserving the original host for TLS SNI/verification.
        transport._create_connection = _connect_pinned
        headers = {"Accept": "application/json", "User-Agent": "SGRS-Dashboard/2.0", **connection_headers(config)}
        transport.request("GET", parsed.path.rstrip("/") + suffix, headers=headers)
        response = transport.getresponse()
        payload = response.read(4 * 1024 * 1024 + 1)
        if len(payload) > 4 * 1024 * 1024:
            raise ValueError("Response too large")
        # Never reflect upstream error pages (which might echo credentials).
        if not 200 <= response.status < 300:
            return response.status, b'{"error":"La API no acepto la consulta."}', "application/json"
        if "json" not in response.getheader("Content-Type", "").lower():
            raise ValueError("Expected JSON")
        json.loads(payload)
        return response.status, payload, "application/json; charset=utf-8"
    except Exception:
        return 502, b'{"error":"Servicio API no disponible. Revisa la configuracion de conexion."}', "application/json"
    finally:
        if transport:
            transport.close()


def _fetch_upstream(url, method="GET", headers=None, body=None, timeout=4.0):
    if method != "GET":
        return 403, b'{"error":"Metodo no permitido."}', "application/json"
    for name, base in (("forti", FORTI_API_URL), ("omni", OMNI_API_URL)):
        if url.startswith(base + "/"):
            return _configured_request(connection(name), url[len(base):], timeout)
    return 403, b'{"error":"Destino no permitido."}', "application/json"


def _get_device_icon(dev_type, hardware_family, os_name):
    txt = f"{dev_type or ''} {hardware_family or ''} {os_name or ''}".lower()
    if any(w in txt for w in ("phone", "iphone", "android", "movil", "celular", "ipad", "tablet")):
        return "📱"
    if any(w in txt for w in ("print", "impresora", "ricoh", "epson", "hp laserjet")):
        return "▣"
    if any(w in txt for w in ("server", "servidor", "storage", "nas", "pacs")):
        return "▤"
    if any(w in txt for w in ("ap", "access point", "wireless", "wifi", "aruba", "alcatel")):
        return "⌁"
    if any(w in txt for w in ("switch", "router", "firewall", "fortigate", "core")):
        return "⌘"
    if any(w in txt for w in ("cam", "cámara", "dvr", "nvr")):
        return "◉"
    return "💻"


def _format_activity(is_online, last_seen):
    if is_online:
        return "Ahora"
    if not last_seen:
        return "Desconocido"
    try:
        ts = float(last_seen)
        diff = time.time() - ts
        if diff < 60:
            return "Ahora"
        elif diff < 3600:
            return f"Hace {int(diff // 60)} min"
        elif diff < 86400:
            return f"Hace {int(diff // 3600)} h"
        else:
            return f"Hace {int(diff // 86400)} d"
    except Exception:
        return str(last_seen)


# Cache en memoria para cotejo no bloqueante con OmniVista (Company Property)
_omni_cache_lock = threading.Lock()
_omni_devices_cache = {
    "by_mac": {},
    "updated_at": 0,
    "fetching": False
}

def _refresh_omni_devices_cache():
    with _omni_cache_lock:
        if _omni_devices_cache["fetching"]:
            return
        _omni_devices_cache["fetching"] = True
    try:
        by_mac = {}
        for page in range(1, 10):
            code, body, _ = _fetch_upstream(f"{OMNI_API_URL}/company-properties?page={page}&page_size=500", timeout=6.0)
            if code != 200:
                break
            try:
                payload = json.loads(body.decode("utf-8"))
                items = (payload.get("data") or {}).get("items") or []
            except Exception:
                break
            if not items:
                break
            for item in items:
                if not isinstance(item, dict):
                    continue
                raw_mac = item.get("deviceMac") or ""
                clean_mac = "".join(c for c in str(raw_mac).upper() if c.isalnum())
                if clean_mac:
                    by_mac[clean_mac] = {
                        "matched": True,
                        "mac": clean_mac,
                        "device_name": item.get("deviceName"),
                        "account": item.get("account") or item.get("employeeAccount"),
                        "location": item.get("lastAccessLocation"),
                        "ap_name": item.get("lastAccessDeviceName"),
                        "ssid": item.get("lastAccessDeviceSSID"),
                        "profile": item.get("accessRoleProfile"),
                        "category": item.get("deviceCategory"),
                        "family": item.get("deviceFamily"),
                        "os": item.get("deviceOS"),
                        "status": item.get("status"),
                    }
            if len(items) < 500:
                break
        if by_mac:
            with _omni_cache_lock:
                _omni_devices_cache["by_mac"] = by_mac
                _omni_devices_cache["updated_at"] = time.time()
    except Exception:
        pass
    finally:
        with _omni_cache_lock:
            _omni_devices_cache["fetching"] = False

def get_omni_device_by_mac(mac):
    clean_mac = "".join(c for c in str(mac or "").upper() if c.isalnum())
    if not clean_mac:
        return None
    now = time.time()
    if now - _omni_devices_cache["updated_at"] > 300 and not _omni_devices_cache["fetching"]:
        threading.Thread(target=_refresh_omni_devices_cache, daemon=True).start()
    return _omni_devices_cache["by_mac"].get(clean_mac)

def ensure_omni_cache_warm(max_wait=1.5):
    if _omni_devices_cache["by_mac"]:
        return
    if not _omni_devices_cache["fetching"]:
        t = threading.Thread(target=_refresh_omni_devices_cache, daemon=True)
        t.start()
        t.join(timeout=max_wait)


class Handler(AccessRoutes, ReportRoutes, http.server.SimpleHTTPRequestHandler):
    def inventory_fetch(self, provider, endpoint):
        return _configured_request(connection(provider), endpoint, timeout=6)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Evitar errores si la petición fue rechazada antes de definir self.path
        path = getattr(self, 'path', '')
        if path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        if getattr(self, '_session_cookie', None):
            self.send_header('Set-Cookie', self._session_cookie)
            self._session_cookie = None
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _send_raw(self, body_bytes, status=200, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _send_json(self, data, status=200):
        if status == 200 and self.path not in ('/api/auth/session', '/api/auth/login'):
            data = self.viewer_projection(data)
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self._send_raw(body, status=status, content_type='application/json; charset=utf-8')

    def do_GET(self):
        if self.access_get():
            return
        path = getattr(self, 'path', '')

        # 1. Reportes y telemetría QR
        if path == '/api/reports':
            try:
                with _file_lock:
                    with open(REPORTS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                self._send_json(tagged_reports(data))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 2. Catálogo completo de IDFs y Racks
        elif path == '/api/idfs':
            try:
                with _file_lock:
                    with open(IDFS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                self._send_json([{**idf, 'incidents': [{**r, 'record_key': report_key(r)} for r in idf.get('incidents', [])]}
                                 for idf in cabinets_with_documentary(data)])
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 3. Pool de Direccionamiento IP (IPAM)
        elif path == '/api/ips':
            try:
                with _file_lock:
                    with open(IPS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                self._send_json(data)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 3b. Consulta segura de cuentas y terminales OmniVista para Gestión de Altas.
        # La página es sólo lectura: se exponen campos explícitos, nunca credenciales,
        # PSK, políticas completas ni el objeto bruto del proveedor.
        elif path == '/api/altas/omnivista':
            def omni_collection(endpoint, fields, identity_keys):
                """Fetch every bounded page; the provider does not publish a reliable total."""
                rows_by_id = {}
                status_code = 200
                complete = False
                page_size = 500
                max_pages = 20
                for page_number in range(1, max_pages + 1):
                    code, body, _ = _fetch_upstream(f"{OMNI_API_URL}/{endpoint}?page={page_number}&page_size={page_size}", timeout=30.0)
                    status_code = code
                    if code != 200:
                        return list(rows_by_id.values()), code, False
                    try:
                        payload = json.loads(body.decode('utf-8'))
                        data = payload.get('data') if isinstance(payload, dict) else None
                        page_rows = data.get('items', []) if isinstance(data, dict) else data
                        if not isinstance(page_rows, list):
                            return list(rows_by_id.values()), 502, False
                    except (ValueError, UnicodeError, AttributeError):
                        return list(rows_by_id.values()), 502, False
                    for row in page_rows:
                        if isinstance(row, dict):
                            projected = {key: row.get(key) for key in fields if key in row}
                            identity = next((str(projected.get(key) or row.get(key)) for key in identity_keys if projected.get(key) or row.get(key)), None)
                            rows_by_id[identity or f"page-{page_number}-row-{len(rows_by_id)}"] = projected
                    if len(page_rows) < page_size:
                        complete = True
                        break
                return list(rows_by_id.values()), status_code, complete
            users, users_status, users_complete = omni_collection('employees', ('username', 'fullName', 'department', 'position', 'accessRoleProfile', 'status', 'email'), ('username', 'id'))
            devices, devices_status, devices_complete = omni_collection('company-properties', ('deviceMac', 'deviceName', 'account', 'employeeAccount', 'accessRoleProfile', 'deviceCategory', 'deviceFamily', 'deviceOS', 'status', 'lastAccessDeviceName', 'lastAccessLocation'), ('deviceMac', 'id'))
            # Cotejo de Company Property contra el inventario observado por FortiGate.
            forti_by_mac, forti_by_ip = {}, {}
            forti_status = 502
            try:
                code, body, _ = _fetch_upstream(f"{FORTI_API_URL}/devices?status=all&active_window=3600", timeout=30.0)
                forti_status = code
                payload = json.loads(body.decode('utf-8'))
                for item in ((payload.get('data') or {}).get('devices') or []):
                    if not isinstance(item, dict):
                        continue
                    projected = {"name": item.get("hostname") or item.get("ip") or item.get("mac"), "ip": item.get("ip"), "mac": item.get("mac"), "type": item.get("device_type") or item.get("hardware_family"), "vendor": item.get("hardware_vendor"), "interface": item.get("interface"), "status": "online" if item.get("is_online") else "offline", "last_seen": item.get("last_seen")}
                    mac = ''.join(ch for ch in str(projected.get("mac") or '').lower() if ch.isalnum())
                    ip = str(projected.get("ip") or '').strip()
                    if mac: forti_by_mac[mac] = projected
                    if ip: forti_by_ip[ip] = projected
            except (ValueError, UnicodeError, AttributeError, TypeError):
                pass
            def association_key(value):
                """Canonical key for OmniVista identity fields (case/spacing/accents agnostic)."""
                text = unicodedata.normalize('NFKD', str(value or '').strip().casefold())
                return ''.join(char for char in text if char.isalnum())

            def device_name_base(value):
                """Return the account portion of OmniVista names such as usuario - cel/lap."""
                raw = str(value or '').strip().casefold()
                match = re.match(r'^(.*?)(?:\s*[-_/]\s*)(cel|lap)(?:\b|$)', raw)
                if match:
                    return association_key(match.group(1)), match.group(2)
                return association_key(raw), None

            user_index = {}
            for user in users:
                for field in ("username", "email"):
                    value = association_key(user.get(field))
                    if value:
                        user_index.setdefault(value, user.get("username"))
            # Algunos endpoints devuelven deviceName como usuario + sufijo de terminal
            # (por ejemplo usuario-lap / usuario-cel). Se ordena por longitud para
            # evitar que un usuario corto capture al usuario más específico.
            prefix_index = sorted(
                ((key, username) for key, username in user_index.items() if len(key) >= 5),
                key=lambda item: len(item[0]),
                reverse=True,
            )
            grouped = {}
            forti_matches = 0
            associated_devices = 0
            for device in devices:
                candidates = [device.get("employeeAccount"), device.get("account"), device.get("deviceName")]
                account = None
                association_source = None
                for value, source in zip(candidates, ("employeeAccount", "account", "deviceName")):
                    key = association_key(value)
                    if key in user_index:
                        account = user_index[key]
                        association_source = source
                        break
                if not account:
                    device_name, device_suffix = device_name_base(device.get("deviceName"))
                    # El formato -cel/-lap es el identificador de cuenta usado por
                    # Company Property para terminales móviles y laptops.
                    if device_suffix:
                        account = user_index.get(device_name)
                        if account:
                            association_source = f"deviceName-base-{device_suffix}"
                if not account:
                    device_name = association_key(device.get("deviceName"))
                    for key, username in prefix_index:
                        if device_name.startswith(key):
                            account = username
                            association_source = "deviceName-prefijo"
                            break
                mac = ''.join(ch for ch in str(device.get("deviceMac") or '').lower() if ch.isalnum())
                match = forti_by_mac.get(mac)
                if match:
                    forti_matches += 1
                item = {**device, "forti": match, "cotejo": "encontrado" if match else "sin coincidencia en FortiGate", "asociacion": association_source or "sin cuenta coincidente"}
                if account:
                    associated_devices += 1
                    grouped.setdefault(account.casefold(), []).append(item)
            for user in users:
                account = str(user.get("username") or '').strip().lower()
                user["devices"] = grouped.get(account, [])
            self._send_json({"success": users_status == 200, "data": {"users": users, "sources": {"users": {"status": users_status, "complete": users_complete, "count": len(users)}, "company_properties": {"status": devices_status, "complete": devices_complete, "count": len(devices), "associated": associated_devices, "unassociated": max(0, len(devices) - associated_devices)}, "fortigate": {"status": forti_status, "count": len(forti_by_mac), "matches": forti_matches} }}, "message": "Cotejo completo de cuentas, dispositivos y FortiGate en modo lectura."})

        # 3c. Consulta de Access Points en tiempo real desde OmniVista
        elif path == '/api/aps/omnivista':
            try:
                code, body, _ = _fetch_upstream(f"{OMNI_API_URL}/monitoring/devices", timeout=20.0)
                if code != 200:
                    self._send_json({"error": "No se pudo consultar el servicio de OmniVista.", "aps": [], "summary": {}}, 502)
                    return
                payload = json.loads(body.decode('utf-8'))
                items = payload.get('data') if isinstance(payload, dict) else []
                if not isinstance(items, list):
                    items = []
                aps = []
                for row in items:
                    if not isinstance(row, dict):
                        continue
                    others = row.get('others') or {}
                    is_ap = row.get('deviceType') == 'HAP' or str(others.get('workMode', '')).upper() == 'AP'
                    if not is_ap:
                        continue
                    serial_info = others.get('serialNumber') or []
                    serial = '—'
                    if isinstance(serial_info, list) and serial_info and isinstance(serial_info[0], dict):
                        serial = serial_info[0].get('chassisSerialNumber') or '—'
                    st = str(row.get('status') or 'Down').strip()
                    is_online = st.lower() == 'up'
                    clients = others.get('noOfClients', 0)
                    try:
                        clients = int(clients)
                    except (ValueError, TypeError):
                        clients = 0
                    channels = others.get('channel') or []
                    if not isinstance(channels, list):
                        channels = [str(channels)] if channels else []
                    ssids = others.get('ssids') or []
                    if not isinstance(ssids, list):
                        ssids = [str(ssids)] if ssids else []

                    location_str = str(row.get('location') or 'No asignada').strip()
                    idf_prefix = location_str.split('->')[0].strip() if '->' in location_str else location_str

                    aps.append({
                        "id": str(row.get("instanceid") or row.get("macAddress") or row.get("ipAddress") or len(aps)),
                        "name": str(row.get("name") or row.get("friendlyName") or "AP"),
                        "model": str(row.get("model") or "Alcatel AP"),
                        "ip": str(row.get("ipAddress") or "—"),
                        "mac": str(row.get("macAddress") or "—"),
                        "serial": serial,
                        "status": "online" if is_online else "offline",
                        "status_raw": st,
                        "location": location_str,
                        "idf_tag": idf_prefix,
                        "clients": clients,
                        "channels": channels,
                        "ssids": ssids,
                        "version": str(row.get("version") or "—"),
                        "last_seen": row.get("lastKnownUpAt"),
                    })
                total = len(aps)
                online = sum(1 for a in aps if a['status'] == 'online')
                offline = total - online
                total_clients = sum(a['clients'] for a in aps)
                self._send_json({
                    "success": True,
                    "aps": aps,
                    "summary": {
                        "total": total,
                        "online": online,
                        "offline": offline,
                        "clients": total_clients,
                    }
                })
            except Exception as e:
                self._send_json({"error": f"Error al procesar los puntos de acceso: {str(e)}", "aps": [], "summary": {}}, 500)

        # 4. Catálogo general de dispositivos (Integrado en vivo con API Forti + Fallback)
        elif path.startswith('/api/devices'):
            devices_data = None
            summary_info = None
            try:
                status_code, body, _ = _fetch_upstream(f"{FORTI_API_URL}/devices?view=operational&status=all&active_window=3600", timeout=10.0)
                if status_code == 200:
                    raw_json = json.loads(body.decode('utf-8'))
                    forti_data = raw_json.get("data") or {}
                    forti_devices = forti_data.get("devices", [])
                    if isinstance(forti_devices, list):
                        summary_info = {
                            "total_inventory": forti_data.get("total_inventory", len(forti_devices)),
                            "online_devices": forti_data.get("online_devices", 0),
                            "offline_devices": forti_data.get("offline_devices", 0),
                            "returned_count": forti_data.get("returned_count", len(forti_devices)),
                        }
                        ensure_omni_cache_warm(max_wait=1.5)
                        mapped_devices = []
                        for dev in forti_devices:
                            ip = dev.get("ip") or "—"
                            raw_mac = dev.get("mac") or ""
                            clean_mac = "".join(c for c in str(raw_mac).upper() if c.isalnum())
                            ov = get_omni_device_by_mac(clean_mac) if clean_mac else None

                            name = dev.get("hostname") or dev.get("mac") or ip
                            if ov and ov.get("device_name"):
                                h = str(dev.get("hostname") or "")
                                if not h or h == ip or h == raw_mac or h.startswith("MAC-") or len(h) == 36:
                                    name = ov.get("device_name")

                            dev_type = dev.get("device_type") or dev.get("hardware_family") or (ov.get("category") if ov else None) or dev.get("os_name") or (ov.get("os") if ov else None) or "Dispositivo"
                            icon = _get_device_icon(dev.get("device_type"), dev.get("hardware_family"), dev.get("os_name") or (ov.get("os") if ov else None))
                            vendor = dev.get("hardware_vendor") or (ov.get("family") if ov else None) or "Fortinet"
                            interface = dev.get("interface") or (ov.get("ssid") if ov else None) or "LAN"
                            location = (ov.get("location") if (ov and ov.get("location")) else None) or f"{vendor} · {interface}"
                            is_online = bool(dev.get("is_online"))
                            status = "online" if is_online else "offline"
                            activity = _format_activity(is_online, dev.get("last_seen"))
                            mapped_devices.append({
                                "name": name,
                                "hostname": dev.get("hostname") or name,
                                "user": dev.get("user") or dev.get("unauthenticated_user") or (ov.get("account") if ov else "—"),
                                "serial": dev.get("serial") or dev.get("serial_number") or dev.get("hardware_serial") or (ov.get("serialNumber") if ov else None) or (dev.get("hostname") if dev.get("hostname") and ("-" in str(dev.get("hostname")) or len(str(dev.get("hostname"))) >= 6) else "—"),
                                "detected_device": dev.get("detected_device") or dev.get("hostname") or name,
                                "fortigate": dev.get("fortigate") or "ISSSTE-TLAJOMULCOB",
                                "ip": ip,
                                "type": dev_type,
                                "icon": icon,
                                "location": location,
                                "status": status,
                                "is_reserved": bool(dev.get("is_reserved")),
                                "ip_source": dev.get("ip_source"),
                                "reserved_ip": dev.get("reserved_ip"),
                                "activity": activity,
                                "mac": raw_mac or "—",
                                "vendor": vendor,
                                "os": dev.get("os_name") or (ov.get("os") if ov else None) or "—",
                                "interface": interface,
                                "omnivista": ov,
                                "raw": dev,
                            })
                        try:
                            presence_map = record_device_presence(mapped_devices)
                            for d in mapped_devices:
                                clean_mac = normalize_mac(d.get("mac"))
                                hist = presence_map.get(clean_mac)
                                if hist:
                                    d["uptime_seconds"] = hist.get("current_session_seconds", 0)
                                    d["first_connected_at"] = hist.get("first_connected_at")
                                    d["total_connected_seconds"] = hist.get("total_connected_seconds", 0)
                                    if hist.get("serial") and hist.get("serial") != "—" and (not d.get("serial") or d.get("serial") == "—"):
                                        d["serial"] = hist.get("serial")
                                else:
                                    d["uptime_seconds"] = 0
                                    d["first_connected_at"] = None
                                    d["total_connected_seconds"] = 0
                        except Exception:
                            for d in mapped_devices:
                                d.setdefault("uptime_seconds", 0)
                                d.setdefault("first_connected_at", None)
                                d.setdefault("total_connected_seconds", 0)
                        devices_data = mapped_devices
            except Exception:
                pass

            if devices_data is None:
                self._send_json({"error": "No se pudo comprobar la actividad y las reservas DHCP. Actualiza la consulta."}, 502)
                return

            parsed_path = urlsplit(path)
            clean_path = parsed_path.path
            params = parse_qs(parsed_path.query)

            # Soporte de filtrado por tipo (ej. Computadora, Impresora)
            if params.get("type"):
                target_type = params["type"][0].strip().lower()
                devices_data = [d for d in devices_data if d.get("type", "").lower() == target_type or format_device_type(d).lower() == target_type]

            # Soporte de filtrado por estado online
            if params.get("online_only") in (["1"], ["true"], ["True"]) or params.get("status") == ["online"]:
                devices_data = [d for d in devices_data if d.get("status") == "online"]

            # Soporte de exportación CSV para listados (incluyendo computadoras e impresoras)
            if clean_path == '/api/devices/export' or params.get("export") == ["csv"]:
                out = io.StringIO()
                out.write('\ufeff')
                writer = csv.writer(out)
                writer.writerow([
                    "Dispositivo / Hostname",
                    "IP",
                    "MAC",
                    "Número de Serie",
                    "Usuario",
                    "Sistema Operativo",
                    "Interfaz",
                    "Tipo",
                    "Estado",
                    "FortiGate",
                    "Tiempo Conectado (s)",
                    "Ubicación"
                ])
                for d in devices_data:
                    writer.writerow([
                        d.get("hostname") or d.get("detected_device") or d.get("name") or "—",
                        d.get("ip") or "—",
                        d.get("mac") or "—",
                        d.get("serial") or "—",
                        d.get("user") or "—",
                        d.get("os") or "—",
                        d.get("interface") or "—",
                        d.get("type") or "—",
                        d.get("status") or "—",
                        d.get("fortigate") or "ISSSTE-TLAJOMULCOB",
                        d.get("uptime_seconds", 0),
                        d.get("location") or "—",
                    ])
                csv_bytes = out.getvalue().encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                fn_type = params.get("type", ["dispositivos"])[0].lower()
                self.send_header('Content-Disposition', f'attachment; filename="{fn_type}.csv"')
                self.send_header('Content-Length', str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)
                return

            if clean_path.startswith('/api/devices/summary') and summary_info:
                self._send_json(summary_info)
            else:
                self._send_json(devices_data)

        # 5. Telemetría de tráfico por IP (Integrado con endpoint /api/v1/traffic/ip/{ip} de FortiGate)
        elif path.startswith('/api/traffic/ip/'):
            subpath = path[len('/api/traffic/ip/'):]
            target_url = f"{FORTI_API_URL}/traffic/ip/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=12.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 6a. Métricas completas de saturación de redes DHCP
        elif path == '/api/forti/network/dhcp-pools' or path.startswith('/api/forti/network/dhcp-pools'):
            subpath = path[len('/api/forti/'):]
            target_url = f"{FORTI_API_URL}/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=12.0)
            if status_code == 200:
                try:
                    payload = json.loads(body.decode('utf-8'))
                    if isinstance(payload, dict):
                        data = payload.get("data")
                        pools = data.get("pools") if isinstance(data, dict) else (payload.get("pools") if isinstance(payload.get("pools"), list) else None)
                        if isinstance(pools, list):
                            critical_count = 0
                            warning_count = 0
                            for pool in pools:
                                if isinstance(pool, dict):
                                    cap = int(pool.get("capacity") or 0)
                                    leases = int(pool.get("active_leases") or 0)
                                    avail = max(0, cap - leases) if pool.get("available_ips") is None else int(pool.get("available_ips"))
                                    util = float(pool.get("utilization_percent")) if pool.get("utilization_percent") is not None else (round((leases / cap * 100), 1) if cap > 0 else 0.0)
                                    if util >= 80.0:
                                        sat_status = "critical"
                                        critical_count += 1
                                    elif util >= 50.0:
                                        sat_status = "warning"
                                        warning_count += 1
                                    else:
                                        sat_status = "normal"
                                    pool["capacity"] = cap
                                    pool["active_leases"] = leases
                                    pool["available_ips"] = avail
                                    pool["utilization_percent"] = util
                                    pool["saturation_status"] = sat_status
                                    pool["status"] = sat_status
                            if isinstance(data, dict):
                                if "critical_pools_count" in data:
                                    data["critical_pools_count"] = critical_count
                                if "warning_pools_count" in data:
                                    data["warning_pools_count"] = warning_count
                            self._send_json(payload)
                            return
                except Exception:
                    pass
            self._send_raw(body, status=status_code, content_type=ctype)

        # 6. Proxy para API Forti (Puerto 8001)
        elif path.startswith('/api/forti/'):
            subpath = path[len('/api/forti/'):]
            target_url = f"{FORTI_API_URL}/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=12.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 7. Proxy para API OmniVista (Puerto 8000)
        elif path.startswith('/api/omni/'):
            subpath = path[len('/api/omni/'):]
            target_url = f"{OMNI_API_URL}/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=12.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 8. Verificación de salud global de la plataforma (Health Check)
        elif path == '/api/health':
            forti_code, forti_body, _ = _fetch_upstream(f"{FORTI_API_URL}/health", timeout=5)
            omni_code, omni_body, _ = _fetch_upstream(f"{OMNI_API_URL}/system/health", timeout=5)
            forti_ok = upstream_healthy("forti", forti_code, forti_body)
            omni_ok = upstream_healthy("omni", omni_code, omni_body)
            self._send_json({
                "status": "ok" if forti_ok and omni_ok else "degraded",
                "forti": forti_ok,
                "omni": omni_ok,
                "dashboard": True,
            })

        # 9. Detección de IP de red para QR
        elif path == '/api/ip':
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('10.255.255.255', 1))
                ip = s.getsockname()[0]
            except Exception:
                ip = '127.0.0.1'
            finally:
                s.close()
            active_port = getattr(self.server, "server_port", PORT)
            self._send_json({"ip": f"{ip}:{active_port}"})

        else:
            try:
                return super().do_GET()
            except (ConnectionResetError, ConnectionAbortedError):
                pass

    def do_POST(self):
        if self.access_post():
            return
        path = getattr(self, 'path', '')

        # AccessRoutes handles accounts, configuration and validated mobile reports.
        # Only authorized inventory mutations reach the compatibility handlers below.
        if path == '/api/ips/update':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))

                target_ip = payload.get("ip")
                if not target_ip:
                    self._send_json({"error": "Falta parámetro 'ip'"}, 400)
                    return

                with _file_lock:
                    with open(IPS_FILE, 'r', encoding='utf-8') as f:
                        ips = json.load(f)

                    updated = False
                    for item in ips:
                        if item.get("ip") == target_ip:
                            if payload.get("action") == "release" or payload.get("status") == "available":
                                item["status"] = "available"
                                item["hostname"] = "—"
                                item["device"] = "—"
                                item["notes"] = "Dirección liberada disponible en el pool"
                            else:
                                for k in ["hostname", "status", "vlan", "device", "mac", "port", "notes"]:
                                    if k in payload and payload[k] is not None:
                                        item[k] = payload[k]
                            updated = True
                            break

                    if not updated:
                        ips.append(payload)

                    with open(IPS_FILE, 'w', encoding='utf-8') as f:
                        json.dump(ips, f, indent=2, ensure_ascii=False)

                self._send_json({"status": "success", "ip": target_ip})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 3. Agregar, actualizar o sincronizar dispositivos en un IDF
        elif path == '/api/idfs/device':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))

                idf_id = payload.get("idf_id")
                device = payload.get("device")
                devices = payload.get("devices")
                if not idf_id or (device is None and devices is None):
                    self._send_json({"error": "Faltan parámetros 'idf_id' y ('device' o 'devices')"}, 400)
                    return

                with _file_lock:
                    with open(IDFS_FILE, 'r', encoding='utf-8') as f:
                        idfs = json.load(f)

                    target_idf = next((i for i in idfs if i.get("id") == idf_id), None)
                    if not target_idf:
                        self._send_json({"error": f"IDF '{idf_id}' no encontrado"}, 404)
                        return

                    if devices is not None and isinstance(devices, list):
                        target_idf["devices"] = devices
                    elif device is not None:
                        idx = payload.get("index")
                        if "devices" not in target_idf:
                            target_idf["devices"] = []
                        if idx is not None and isinstance(idx, int) and 0 <= idx < len(target_idf["devices"]):
                            target_idf["devices"][idx] = device
                        else:
                            target_idf["devices"].append(device)

                    with open(IDFS_FILE, 'w', encoding='utf-8') as f:
                        json.dump(idfs, f, indent=2, ensure_ascii=False)

                self._send_json({"status": "success", "idf_id": idf_id})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Evitar bloquear I/O en logs ruidosos
        try:
            super().log_message(format, *args)
        except Exception:
            pass

    def probe_connection(self, value):
        return _configured_request(value, "/health" if value["id"] == "forti" else "/system/health", timeout=8.0)

    def report_context(self):
        return REPORTS_FILE, IDFS_FILE, _file_lock


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    # Reuse only the matching local API's existing key; never forward it to a
    # custom destination. Explicit environment and saved connections win.
    from dotenv import dotenv_values
    for service, folder, api_port in (("forti", "API Forti", 8001), ("omni", "API Omni", 8000)):
        local_url = f"http://127.0.0.1:{api_port}/api/v1"
        key_name = f"{service.upper()}_API_KEY"
        if not os.environ.get(key_name) and not os.environ.get("APP_API_KEY") and os.environ.get(f"{service.upper()}_API_URL", local_url) == local_url:
            local_env = dotenv_values(os.path.join(os.path.dirname(os.path.abspath(__file__)), folder, ".env"))
            local_key = local_env.get("APP_API_KEY") or local_env.get("API_SECRET_KEY")
            if local_key:
                os.environ[key_name] = local_key.split(",")[0].strip().strip("\"'")
    public_origin = os.environ.get("SGRS_PUBLIC_ORIGIN", "")
    if public_origin:
        parsed_origin = urlsplit(public_origin)
        if parsed_origin.scheme != "https" or not parsed_origin.hostname or parsed_origin.username or parsed_origin.password or parsed_origin.path not in ("", "/") or parsed_origin.query or parsed_origin.fragment:
            raise SystemExit("SGRS_PUBLIC_ORIGIN debe ser un origen HTTPS, sin ruta ni credenciales.")
    if not os.path.isfile(os.path.join(DIRECTORY, "index.html")):
        raise SystemExit("Falta compilar el dashboard: ejecuta npm ci y npm run build en Dashboard/.")
    preferred_port = int(os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT", 3000))
    candidate_ports = [preferred_port]
    if 3001 not in candidate_ports:
        candidate_ports.append(3001)
    if 3002 not in candidate_ports:
        candidate_ports.append(3002)

    started = False
    for p in candidate_ports:
        try:
            server = ThreadedHTTPServer((os.environ.get("DASHBOARD_HOST", "127.0.0.1"), p), Handler)
            PORT = p
            print("====================================================")
            print(f"  S.G.R.S Servidor Multi-hilo Activo en Puerto {PORT}")
            print(f"  Dashboard disponible en: http://localhost:{PORT}")
            print("  Base de datos conectada en ./data/")
            print("====================================================")
            started = True
            stop_metrics = start_collector(lambda service, path: _configured_request(connection(service), path, timeout=12))
            try:
                server.serve_forever()
            finally:
                stop_metrics.set()
                server.server_close()
            break
        except OSError as e:
            print(f"[SGRS] Puerto {p} ocupado ({e}). Intentando puerto alternativo...")
            continue

    if not started:
        print("[SGRS] Error crítico: No se pudo enlazar ningún puerto para el servidor del Dashboard.")
