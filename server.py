import http.server
import socketserver
import json
import os
import socket
import threading
import time
import urllib.request
import urllib.error

# Lock global para proteger lecturas/escrituras concurrentes a archivos JSON
_file_lock = threading.Lock()

PORT = int(os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT", 3000))
DIRECTORY = "Dashboard"
DATA_DIR = "data"

FORTI_API_URL = os.environ.get("FORTI_API_URL", "http://127.0.0.1:8001/api/v1")
OMNI_API_URL = os.environ.get("OMNI_API_URL", "http://127.0.0.1:8000/api/v1")
APP_API_KEY = os.environ.get("APP_API_KEY", "admin")

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


def _fetch_upstream(url, method="GET", headers=None, body=None, timeout=4.0):
    """Envía peticiones HTTP a los microservicios backend (API Forti / API Omni)."""
    hdrs = {
        "User-Agent": "SGRS-Dashboard-Server/1.0",
        "Accept": "application/json",
    }
    if APP_API_KEY:
        hdrs["X-API-Key"] = APP_API_KEY
    if headers:
        for k, v in headers.items():
            if k.lower() not in ("host", "content-length"):
                hdrs[k] = v
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "application/json")
    except Exception as ex:
        err_body = json.dumps({"error": f"Servicio upstream no disponible: {ex}"}).encode('utf-8')
        return 502, err_body, "application/json"


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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Evitar errores si la petición fue rechazada antes de definir self.path
        path = getattr(self, 'path', '')
        if path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        
        # Permitir CORS para cualquier cliente en la red local
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
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
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self._send_raw(body, status=status, content_type='application/json; charset=utf-8')

    def do_GET(self):
        path = getattr(self, 'path', '')

        # 1. Reportes y telemetría QR
        if path == '/api/reports':
            try:
                with _file_lock:
                    with open(REPORTS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                self._send_json(data)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 2. Catálogo completo de IDFs y Racks
        elif path == '/api/idfs':
            try:
                with _file_lock:
                    with open(IDFS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                self._send_json(data)
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

        # 4. Catálogo general de dispositivos (Integrado en vivo con API Forti + Fallback)
        elif path.startswith('/api/devices'):
            devices_data = None
            summary_info = None
            try:
                status_code, body, _ = _fetch_upstream(f"{FORTI_API_URL}/devices?status=all&active_window=3600", timeout=3.0)
                if status_code == 200:
                    raw_json = json.loads(body.decode('utf-8'))
                    forti_data = raw_json.get("data") or {}
                    forti_devices = forti_data.get("devices", [])
                    if isinstance(forti_devices, list) and forti_devices:
                        summary_info = {
                            "total_inventory": forti_data.get("total_inventory", len(forti_devices)),
                            "online_devices": forti_data.get("online_devices", 0),
                            "offline_devices": forti_data.get("offline_devices", 0),
                            "returned_count": forti_data.get("returned_count", len(forti_devices)),
                        }
                        mapped_devices = []
                        for dev in forti_devices:
                            ip = dev.get("ip") or "—"
                            name = dev.get("hostname") or dev.get("mac") or ip
                            dev_type = dev.get("device_type") or dev.get("hardware_family") or dev.get("os_name") or "Dispositivo"
                            icon = _get_device_icon(dev.get("device_type"), dev.get("hardware_family"), dev.get("os_name"))
                            vendor = dev.get("hardware_vendor") or "Fortinet"
                            interface = dev.get("interface") or "LAN"
                            location = f"{vendor} · {interface}"
                            is_online = bool(dev.get("is_online"))
                            status = "online" if is_online else "offline"
                            activity = _format_activity(is_online, dev.get("last_seen"))
                            mapped_devices.append({
                                "name": name,
                                "ip": ip,
                                "type": dev_type,
                                "icon": icon,
                                "location": location,
                                "status": status,
                                "activity": activity,
                                "mac": dev.get("mac") or "—",
                                "vendor": vendor,
                                "os": dev.get("os_name") or "—",
                                "interface": interface,
                                "raw": dev,
                            })
                        devices_data = mapped_devices
            except Exception:
                pass

            if devices_data is None:
                try:
                    with _file_lock:
                        with open(DEVICES_FILE, 'r', encoding='utf-8') as f:
                            devices_data = json.load(f)
                except Exception as e:
                    devices_data = []

            if path.startswith('/api/devices/summary') and summary_info:
                self._send_json(summary_info)
            else:
                self._send_json(devices_data)

        # 5. Telemetría de tráfico por IP (Integrado con endpoint /api/v1/traffic/ip/{ip} de FortiGate)
        elif path.startswith('/api/traffic/ip/'):
            subpath = path[len('/api/traffic/ip/'):]
            target_url = f"{FORTI_API_URL}/traffic/ip/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=4.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 6. Proxy para API Forti (Puerto 8001)
        elif path.startswith('/api/forti/'):
            subpath = path[len('/api/forti/'):]
            target_url = f"{FORTI_API_URL}/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=4.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 7. Proxy para API OmniVista (Puerto 8000)
        elif path.startswith('/api/omni/'):
            subpath = path[len('/api/omni/'):]
            target_url = f"{OMNI_API_URL}/{subpath}"
            status_code, body, ctype = _fetch_upstream(target_url, timeout=4.0)
            self._send_raw(body, status=status_code, content_type=ctype)

        # 8. Verificación de salud global de la plataforma (Health Check)
        elif path == '/api/health':
            forti_code, _, _ = _fetch_upstream(f"{FORTI_API_URL.replace('/api/v1', '')}/health", timeout=1.5)
            omni_code, _, _ = _fetch_upstream(f"{OMNI_API_URL.replace('/api/v1', '')}/health", timeout=1.5)
            self._send_json({
                "status": "ok",
                "forti": forti_code == 200,
                "omni": omni_code == 200,
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
        path = getattr(self, 'path', '')

        # Proxy para endpoints POST de API Forti
        if path.startswith('/api/forti/'):
            subpath = path[len('/api/forti/'):]
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else None
            status_code, body, ctype = _fetch_upstream(f"{FORTI_API_URL}/{subpath}", method="POST", body=post_data, timeout=4.0)
            self._send_raw(body, status=status_code, content_type=ctype)
            return

        # Proxy para endpoints POST de API Omni
        if path.startswith('/api/omni/'):
            subpath = path[len('/api/omni/'):]
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else None
            status_code, body, ctype = _fetch_upstream(f"{OMNI_API_URL}/{subpath}", method="POST", body=post_data, timeout=4.0)
            self._send_raw(body, status=status_code, content_type=ctype)
            return

        # 1. Guardar reportes e incidencias QR
        if path == '/api/reports':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))

                idf_id = data.get("idf_id")
                incident = data.get("incident")
                telemetry = data.get("telemetry")

                if not idf_id:
                    self._send_json({"error": "Falta idf_id"}, 400)
                    return

                with _file_lock:
                    with open(REPORTS_FILE, 'r', encoding='utf-8') as f:
                        reports = json.load(f)

                    if idf_id not in reports or type(reports[idf_id]) is list:
                        old_incidents = reports[idf_id] if type(reports.get(idf_id)) is list else []
                        reports[idf_id] = {"incidents": old_incidents, "telemetry": None}

                    if incident:
                        reports[idf_id]["incidents"].insert(0, incident)

                    if telemetry:
                        reports[idf_id]["telemetry"] = telemetry

                    with open(REPORTS_FILE, 'w', encoding='utf-8') as f:
                        json.dump(reports, f, indent=2, ensure_ascii=False)

                self._send_json({"status": "success"})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # 2. Actualizar o liberar dirección IP en el pool (Persistencia en disco)
        elif path == '/api/ips/update':
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


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    preferred_port = int(os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT", 3000))
    candidate_ports = [preferred_port]
    if 3001 not in candidate_ports:
        candidate_ports.append(3001)
    if 3002 not in candidate_ports:
        candidate_ports.append(3002)

    started = False
    for p in candidate_ports:
        try:
            server = ThreadedHTTPServer(("", p), Handler)
            PORT = p
            print("====================================================")
            print(f"  S.G.R.S Servidor Multi-hilo Activo en Puerto {PORT}")
            print(f"  Dashboard disponible en: http://localhost:{PORT}")
            print("  Base de datos conectada en ./data/")
            print("====================================================")
            started = True
            server.serve_forever()
            break
        except OSError as e:
            print(f"[SGRS] Puerto {p} ocupado ({e}). Intentando puerto alternativo...")
            continue

    if not started:
        print("[SGRS] Error crítico: No se pudo enlazar ningún puerto para el servidor del Dashboard.")
