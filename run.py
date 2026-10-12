import json
import errno
import ipaddress
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import venv
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
from urllib.parse import urlsplit

# Configurar salida estándar con UTF-8 para PowerShell / Bash
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parent
PERMANENT_QR_ORIGIN = "http://192.168.38.250:3000"
PERMANENT_QR_PORT = 3000

def load_env_fallback(env_path: Path) -> None:
    """Carga variables desde un archivo .env si python-dotenv no está instalado."""
    if not env_path.is_file():
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip()
                if len(val) >= 2 and ((val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'"))):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass


# Carga segura de variables de entorno desde el archivo .env raíz
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT_DIR / ".env")
except ImportError:
    load_env_fallback(ROOT_DIR / ".env")

PID_FILE = ROOT_DIR / ".sgrs_pids.json"
LOG_DIR = ROOT_DIR / "logs"
MAIN_LOG = LOG_DIR / "sgrs.log"
LAUNCHER_DIR = Path.home() / (".local/bin" if sys.platform != "win32" else "bin")
LAUNCHER_NAMES = ("SGRS", "sgrs")
MIN_PYTHON = (3, 11)


def is_pid_alive(pid: int) -> bool:
    """Verifica si un proceso sigue realmente en ejecución."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if handle:
                exit_code = ctypes.c_ulong()
                ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                ctypes.windll.kernel32.CloseHandle(handle)
                return exit_code.value == 259
            return False
        except Exception:
            try:
                res = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True)
                return str(pid) in res.stdout
            except Exception:
                return False
    else:
        try:
            stat_path = Path(f"/proc/{pid}/stat")
            if stat_path.exists():
                process_state = stat_path.read_text().rsplit(")", 1)[1].split()[0]
                if process_state == "Z":
                    return False
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except (ProcessLookupError, OSError):
            return False


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Verifica si un puerto TCP ya se encuentra en escucha."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            result = s.connect_ex((host, port))
            if result in (errno.EPERM, errno.EACCES):
                raise PermissionError("No hay permiso de red para comprobar los servicios locales.")
            return result == 0
    except PermissionError:
        raise PermissionError("No hay permiso de red para comprobar los servicios locales.") from None


def can_bind_port(port: int) -> bool:
    """Comprueba que el proceso pueda volver a enlazar el puerto solicitado."""
    probe = None
    try:
        probe = socket.socket()
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        if probe is not None:
            try:
                probe.close()
            except OSError:
                pass


def free_port(port: int):
    """Fuerza la liberación de un puerto ocupado."""
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
            for line in out.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[-1].isdigit():
                    pid = parts[-1]
                    if pid != "0" and pid != str(os.getpid()):
                        subprocess.run(["taskkill", "/F", "/PID", pid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    else:
        freed = False
        try:
            res = subprocess.run(["fuser", "-k", f"{port}/tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0:
                freed = True
        except Exception:
            pass
        if not freed:
            try:
                import re
                out = subprocess.check_output(["ss", "-tulpn", f"sport = :{port}"], text=True, stderr=subprocess.DEVNULL)
                pids = set(re.findall(r"pid=(\d+)", out))
                for pid in pids:
                    if pid != str(os.getpid()):
                        os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass


def get_dashboard_port(preferred_port=None) -> int:
    """El Dashboard usa el puerto codificado en todos los QR permanentes."""
    return PERMANENT_QR_PORT


def local_network_ip() -> str:
    """Obtiene la IPv4 usada para alcanzar la red institucional."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("10.255.255.255", 1))
            return probe.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def lan_ipv4_addresses() -> list[str]:
    """Return every active non-loopback IPv4 address on this host."""
    addresses = set()
    try:
        if sys.platform != "win32":
            import fcntl
            import struct

            for _, interface_name in socket.if_nameindex():
                try:
                    request = struct.pack("256s", interface_name.encode()[:15])
                    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                        response = fcntl.ioctl(probe, 0x8915, request)
                    value = socket.inet_ntoa(response[20:24])
                    parsed = ipaddress.ip_address(value)
                    if parsed.is_loopback or parsed.is_link_local or parsed.is_unspecified or parsed.is_multicast:
                        continue
                    addresses.add(str(parsed))
                except (OSError, ValueError):
                    continue
    except (AttributeError, OSError, ValueError, TypeError):
        pass

    if not addresses:
        fallback = local_network_ip()
        if fallback != "127.0.0.1":
            addresses.add(fallback)
    return sorted(addresses)


def _network_tokens(value: str | None) -> list[str]:
    return [token for token in re.split(r"[\s,;]+", (value or "").strip()) if token]


def _ordered_unique(values):
    return list(dict.fromkeys(value for value in values if value))


def api_environment(env: dict, dashboard_port: int, service: str) -> dict:
    """Bind API services to LAN and derive hosts/CORS from active interfaces."""
    configured_origins = _network_tokens(env.get("SGRS_LAN_ORIGIN"))
    configured_hosts = []
    for origin in configured_origins:
        try:
            hostname = urlsplit(origin).hostname
        except ValueError:
            hostname = None
        if hostname and hostname not in ("0.0.0.0", "::"):
            configured_hosts.append(hostname)

    hosts = _ordered_unique(
        ["localhost", "127.0.0.1", "::1", env.get("SGRS_SERVER_IP", "")]
        + configured_hosts
        + lan_ipv4_addresses()
    )
    ports = _ordered_unique([3000, 3001, 3002, dashboard_port])
    origins = _ordered_unique(
        configured_origins
        + [f"http://{host}:{port}" for host in hosts if host not in ("localhost", "127.0.0.1", "::1") for port in ports]
        + [f"http://{host}" for host in hosts if host not in ("localhost", "127.0.0.1", "::1")]
    )
    result = {**env, "SGRS_LAN_ORIGIN": ",".join(origins)}
    if service == "inventarios":
        result.update({
            "INVENTARIOS_HOST": "0.0.0.0",
            "INVENTARIOS_ALLOWED_HOSTS": json.dumps(hosts),
            "INVENTARIOS_CORS_ORIGINS": json.dumps(origins),
        })
    else:
        result.update({
            "SERVER_HOST" if service == "omni" else "HOST": "0.0.0.0",
            "ALLOWED_HOSTS": ",".join(hosts),
            "CORS_ORIGINS": ",".join(origins),
        })
    return result


def dashboard_environment(env: dict, port: int) -> dict:
    """Expone el dashboard en LAN y fija el único origen de red autorizado."""
    configured_lan = (env.get("SGRS_LAN_ORIGIN") or os.environ.get("SGRS_LAN_ORIGIN") or "").strip()

    host = (env.get("DASHBOARD_HOST") or os.environ.get("DASHBOARD_HOST") or "").strip()
    if not host:
        host = "0.0.0.0" if configured_lan else "127.0.0.1"

    lan_origin = configured_lan if configured_lan else f"http://{local_network_ip()}:{port}"

    result = {
        **env,
        "PORT": str(port),
        "DASHBOARD_PORT": str(port),
        "DASHBOARD_HOST": host,
        "SGRS_LAN_ORIGIN": lan_origin,
    }
    return result


def free_ports_if_busy(ports=None, silent: bool = False):
    """Comprueba los puertos de los servicios y libera los que estén bloqueados."""
    if ports is None:
        dash_port = get_dashboard_port()
        ports = [8000, 8001, dash_port]
    for port in ports:
        if is_port_in_use(port):
            if not silent:
                print(f"[SGRS] Puerto {port} ocupado por un proceso previo. Liberando...")
            free_port(port)
            time.sleep(0.3)


def get_python_exe() -> str:
    """Detecta el ejecutable de Python priorizando el entorno virtual .venv local."""
    venv_candidates = [
        ROOT_DIR / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python"),
        ROOT_DIR / "venv" / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python"),
    ]
    for cand in venv_candidates:
        if cand.exists():
            return str(cand)
    return sys.executable


def ensure_supported_python():
    if sys.version_info < MIN_PYTHON:
        raise RuntimeError("S.G.R.S. requiere Python 3.11 o superior.")


def get_npm_exe() -> str:
    """Detecta el ejecutable de npm en el sistema."""
    if sys.platform == "win32" and os.path.exists(r"C:\Program Files\nodejs\npm.cmd"):
        return r"C:\Program Files\nodejs\npm.cmd"
    return shutil.which("npm") or "npm"


def get_env(py_exe: str) -> dict:
    """Genera las variables de entorno adecuadas para los subprocesos."""
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    node_path = r"C:\Program Files\nodejs"
    if os.path.exists(node_path) and node_path not in env.get("PATH", ""):
        env["PATH"] = f"{node_path};" + env.get("PATH", "")

    py_path = Path(py_exe)
    if ".venv" in py_exe or "venv" in py_exe:
        env["VIRTUAL_ENV"] = str(py_path.parent.parent)
        env["PATH"] = f"{py_path.parent}{os.pathsep}" + env.get("PATH", "")
    return env


def windows_no_console_options() -> dict:
    """Opciones de Popen para ejecutar APIs sin abrir una consola por servicio."""
    if sys.platform != "win32":
        return {}
    options = {
        "creationflags": (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    }
    startupinfo_factory = getattr(subprocess, "STARTUPINFO", None)
    if startupinfo_factory:
        startupinfo = startupinfo_factory()
        startupinfo.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        options["startupinfo"] = startupinfo
    return options


def save_pids(pids: dict):
    """Guarda los identificadores de proceso para poder gestionarlos después."""
    temporary = None
    try:
        PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{PID_FILE.name}.", dir=PID_FILE.parent)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(pids, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        if sys.platform != "win32":
            os.chmod(temporary, 0o600)
        os.replace(temporary, PID_FILE)
    except OSError as exc:
        if temporary:
            try:
                os.unlink(temporary)
            except OSError:
                pass
        raise RuntimeError(f"No se pudo guardar el registro de procesos SGRS: {exc}") from exc


def load_pids() -> dict:
    """Carga los PIDs previamente registrados."""
    if PID_FILE.exists():
        try:
            with open(PID_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            pass
    return {}


def get_inventory_port():
    raw_port = os.environ.get("INVENTARIOS_PORT", "8002")
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        raise RuntimeError("INVENTARIOS_PORT debe ser un puerto TCP válido.") from None
    if not 1 <= port <= 65535:
        raise RuntimeError("INVENTARIOS_PORT debe ser un puerto TCP válido.")
    return port


def service_specs(dash_port=None):
    """Catálogo común para iniciar, detener y comprobar los cuatro servicios."""
    if dash_port is None:
        dash_port = get_dashboard_port()
    return [
        {"key": "api_omni", "name": "API OmniVista", "port": 8000, "cwd": ROOT_DIR / "API Omni", "entry": "run.py", "health": "/health"},
        {"key": "api_forti", "name": "API FortiGate", "port": 8001, "cwd": ROOT_DIR / "API Forti", "entry": "run.py", "health": "/health"},
        {"key": "api_inventarios", "name": "API Inventarios", "port": get_inventory_port(), "cwd": ROOT_DIR / "API Inventarios", "entry": "run.py", "health": "/health"},
        {"key": "dashboard", "name": "Dashboard React", "port": dash_port, "cwd": ROOT_DIR, "entry": "server.py", "health": "/"},
    ]


def process_matches_service(service, pid):
    """Comprueba la identidad de un proceso SGRS sin enviarle señales."""
    if sys.platform != "linux":
        return True
    try:
        cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
        args = Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace").split("\0")
    except (OSError, UnicodeError):
        return False
    entry_matches = any(Path(arg).name == service["entry"] for arg in args if arg)
    return cwd == service["cwd"].resolve() and entry_matches


def validate_registered_process(service, pid):
    """Verifica que un PID vivo pertenece al componente registrado."""
    if not process_matches_service(service, pid):
        raise RuntimeError(f"El PID de {service['name']} no corresponde al proceso registrado; no se detuvo.")


def discover_service_processes(service):
    """Encuentra procesos SGRS iniciados sin registro o con un registro perdido."""
    if sys.platform != "linux":
        return []
    matches = []
    for proc_dir in Path("/proc").glob("[0-9]*"):
        try:
            pid = int(proc_dir.name)
        except ValueError:
            continue
        if pid == os.getpid() or not is_pid_alive(pid):
            continue
        if process_matches_service(service, pid):
            matches.append(pid)
    return matches


class RegisteredProcess:
    """Permite esperar un servicio iniciado por una ejecución anterior de SGRS."""

    def __init__(self, pid):
        self.pid = pid

    def poll(self):
        return None if is_pid_alive(self.pid) else 1


def provider_startup_error(service):
    """Expone únicamente el diagnóstico seguro de login de la sesión actual."""
    if service["key"] != "api_omni" or not MAIN_LOG.exists():
        return ""
    lines = MAIN_LOG.read_text(errors="replace").splitlines()
    for line in reversed(lines):
        if "[SGRS] Inicio de sesión en segundo plano:" in line:
            break
        if "[OV-AUTH] " in line:
            reason = line.split("[OV-AUTH] ", 1)[1]
            # Solo mensajes generados por nuestro servicio; nunca respuestas del proveedor.
            allowed = (
                "Faltan OV_USERNAME u OV_PASSWORD.",
                "OmniVista respondió HTTP 200 sin token de acceso.",
                "No se pudo validar el certificado TLS de OmniVista.",
                "OmniVista agotó el tiempo de espera del login.",
                "No se pudo establecer conexión con OmniVista.",
                "OmniVista devolvió una respuesta de login que no es JSON válido.",
            )
            if reason.startswith("No se pudo validar el certificado TLS de OmniVista."):
                if reason == "No se pudo validar el certificado TLS de OmniVista.":
                    reason += " Configure OV_CA_BUNDLE con la CA institucional; no desactive OV_VERIFY_SSL en producción."
                return " " + reason
            if reason in allowed or re.fullmatch(r"OmniVista rechazó el login \(HTTP \d{3}\)\.", reason):
                return " " + reason
            break
    return ""


def service_ready(service):
    """HTTP real: un puerto abierto por sí solo no acredita un arranque correcto."""
    url = f"http://127.0.0.1:{service['port']}{service['health']}"
    try:
        # Las comprobaciones locales no deben pasar por un proxy corporativo.
        with build_opener(ProxyHandler({})).open(url, timeout=1) as response:
            if response.status != 200:
                return False
            if service["key"] == "dashboard":
                page = response.read(8192)
                return b'<div id="root"></div>' in page and b"<title>Centro Operativo" in page
            return json.loads(response.read()).get("status") == "healthy"
    except URLError as exc:
        reason = exc.reason
        if isinstance(reason, OSError) and reason.errno in (errno.EPERM, errno.EACCES):
            raise PermissionError("No hay permiso de red para comprobar los servicios locales.") from None
        return False
    except PermissionError:
        raise PermissionError("No hay permiso de red para comprobar los servicios locales.") from None
    except (OSError, ValueError):
        return False


def wait_for_services(services, processes, timeout=30):
    """Espera la autenticación de las APIs y el arranque HTTP de cada componente."""
    pending = {service["key"]: service for service in services}
    deadline = time.monotonic() + timeout
    while pending:
        for key, service in list(pending.items()):
            process = processes[key]
            if process is None or process.poll() is not None:
                reason = provider_startup_error(service)
                raise RuntimeError(f"{service['name']} falló al arrancar.{reason} Revisa SGRS logs.")
            if service_ready(service):
                del pending[key]
        if not pending:
            return
        if time.monotonic() >= deadline:
            names = ", ".join(service["name"] for service in pending.values())
            raise RuntimeError(f"No quedaron listos en {timeout}s: {names}. Revisa SGRS logs.")
        time.sleep(0.25)


def ensure_inventory_config(py_exe):
    script = ROOT_DIR / "API Inventarios" / "scripts" / "configure_local.py"
    private_env = ROOT_DIR / "API Inventarios" / ".private" / ".env"
    if not private_env.exists():
        subprocess.run([py_exe, str(script)], cwd=str(ROOT_DIR), check=True)


def configured_env_value(env_file, key):
    """Lee una sola variable sin imprimir ni cargar secretos al proceso actual."""
    if not env_file.is_file():
        return None
    try:
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() != key:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    except OSError:
        return None
    return None


def resolve_configured_path(raw_path, base_dir):
    """Resuelve rutas de CA absolutas o relativas al servicio/repositorio."""
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    candidates = [path] if path.is_absolute() else [Path.cwd() / path, base_dir / path, ROOT_DIR / path]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return path


def validate_configured_tls_bundles():
    """Valida rutas CA configuradas antes de crear procesos de servicios."""
    configurations = (
        ("OmniVista", ROOT_DIR / "API Omni" / ".env", "OV_CA_BUNDLE"),
        ("FortiGate", ROOT_DIR / "API Forti" / ".env", "FORTIOS_CA_BUNDLE"),
    )
    for name, env_file, variable in configurations:
        raw_path = os.environ.get(variable) or configured_env_value(env_file, variable)
        if raw_path and not resolve_configured_path(raw_path, env_file.parent).is_file():
            raise RuntimeError(f"{name}: {variable} no apunta a un archivo CA existente.")


def install_launchers():
    """Instala los comandos SGRS/sgrs de forma idempotente en el directorio del usuario."""
    LAUNCHER_DIR.mkdir(parents=True, exist_ok=True)
    installed = []
    if sys.platform == "win32":
        launcher_body = (
            "@echo off\r\n"
            "rem SGRS launcher generado por run.py\r\n"
            f'set "SGRS_ROOT={ROOT_DIR}"\r\n'
            'set "SGRS_PYTHON=%SGRS_ROOT%\\.venv\\Scripts\\python.exe"\r\n'
            'if exist "%SGRS_PYTHON%" goto use_venv\r\n'
            'py -3 "%SGRS_ROOT%\\run.py" %*\r\n'
            'exit /b %errorlevel%\r\n'
            ':use_venv\r\n'
            '"%SGRS_PYTHON%" "%SGRS_ROOT%\\run.py" %*\r\n'
            'exit /b %errorlevel%\r\n'
        )
        for name in LAUNCHER_NAMES:
            launcher = LAUNCHER_DIR / f"{name}.cmd"
            if launcher.exists() and "SGRS launcher generado por run.py" not in launcher.read_text(errors="replace"):
                raise RuntimeError(f"No se reemplazó {launcher}: ya existe y no es un launcher SGRS.")
            launcher.write_text(launcher_body, encoding="utf-8", newline="")
            installed.append(launcher)
        return installed

    target = ROOT_DIR / "sgrs.sh"
    if not target.is_file():
        raise RuntimeError(f"No se encontró el launcher {target}.")
    target.chmod(target.stat().st_mode | 0o111)
    for name in LAUNCHER_NAMES:
        link = LAUNCHER_DIR / name
        if link.is_symlink():
            if link.resolve() != target.resolve():
                raise RuntimeError(f"No se reemplazó {link}: ya apunta a otro archivo.")
        elif link.exists():
            raise RuntimeError(f"No se reemplazó {link}: ya existe y no es un enlace SGRS.")
        else:
            link.symlink_to(target)
        installed.append(link)
    return installed


def ensure_windows_user_path(directory: Path) -> bool:
    """Añade un directorio al PATH del usuario de Windows y al proceso actual."""
    if sys.platform != "win32":
        return False

    import winreg

    directory = Path(directory).resolve()

    def normalized(entry: str) -> str:
        expanded = os.path.expandvars(entry.strip().strip('"'))
        return os.path.normcase(os.path.normpath(expanded))

    access = winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, r"Environment", 0, access) as key:
        try:
            user_path, value_kind = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            user_path, value_kind = "", winreg.REG_EXPAND_SZ

        entries = [entry for entry in user_path.split(os.pathsep) if entry.strip()]
        path_added = normalized(str(directory)) not in {normalized(entry) for entry in entries}
        if path_added:
            entries.append(str(directory))
            value_kind = value_kind if value_kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) else winreg.REG_EXPAND_SZ
            winreg.SetValueEx(key, "Path", 0, value_kind, os.pathsep.join(entries))

    process_entries = os.environ.get("PATH", "").split(os.pathsep)
    if normalized(str(directory)) not in {normalized(entry) for entry in process_entries if entry.strip()}:
        os.environ["PATH"] = os.pathsep.join([*filter(None, process_entries), str(directory)])

    # Avisar a las aplicaciones de Windows; las terminales ya abiertas conservan su PATH.
    try:
        import ctypes

        result = ctypes.c_size_t()
        ctypes.windll.user32.SendMessageTimeoutW(
            0xFFFF, 0x001A, 0, ctypes.c_wchar_p("Environment"), 0x0002, 5000, ctypes.byref(result)
        )
    except (AttributeError, OSError, TypeError):
        pass

    return path_added


def wait_for_ports_free(ports, timeout=10):
    """Espera a que los sockets de una sesión anterior dejen de escuchar."""
    ports = [port for port in ports if isinstance(port, int) and port > 0]
    deadline = time.monotonic() + timeout
    while any(is_port_in_use(port) or not can_bind_port(port) for port in ports):
        if time.monotonic() >= deadline:
            raise RuntimeError("Los puertos de la sesión anterior siguen ocupados; no se inició otra instancia.")
        time.sleep(0.2)


def status_services():
    """Muestra disponibilidad HTTP de todos los componentes de S.G.R.S."""
    display_host = os.environ.get("SGRS_SERVER_IP", "192.168.38.250")
    pids = load_pids()
    # Usar el puerto registrado incluso si el dashboard se detuvo.
    dash_port = pids.get("dashboard_port") or int(os.environ.get("DASHBOARD_PORT", "3000"))
    print("=" * 72)
    print("           ESTADO DE LOS SERVICIOS - S.G.R.S.")
    print("=" * 72)
    for index, service in enumerate(service_specs(dash_port), 1):
        try:
            state = "LISTO" if service_ready(service) else "NO DISPONIBLE"
        except PermissionError:
            state = "NO COMPROBABLE: SIN PERMISO DE RED"
        pid = pids.get(service["key"])
        if isinstance(pid, int) and not is_pid_alive(pid):
            pid = f"{pid} (inactivo)"
        suffix = "/scalar" if service["key"] != "dashboard" else ""
        print(f"  [{index}] {service['name']} ({service['port']}): [{state}] (PID registrado: {pid})")
        print(f"      -> http://{display_host}:{service['port']}{suffix}")
    print("  Comandos: SGRS | SGRS status | SGRS logs | SGRS stop | SGRS restart")
    print("=" * 72 + "\n")


def _signal_process(pid, *, force=False):
    """Envía una señal al grupo creado por SGRS y evita afectar al grupo del runner."""
    if sys.platform == "win32":
        command = ["taskkill"]
        if force:
            command.append("/F")
        command.extend(["/T", "/PID", str(pid)])
        subprocess.run(
            command,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        group = os.getpgid(pid)
        if group == pid and group != os.getpgrp():
            os.killpg(group, sig)
        else:
            os.kill(pid, sig)
    except ProcessLookupError:
        pass


def _wait_for_processes_to_exit(pids, timeout):
    deadline = time.monotonic() + timeout
    while any(is_pid_alive(pid) for pid in pids):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.2)
    return True


def stop_services():
    """Detiene procesos SGRS verificados y limpia registros obsoletos."""
    print("\n[SGRS] Deteniendo servicios de la plataforma...")
    pids = load_pids()
    stopping = {}
    stale = []
    registry_exists = PID_FILE.exists() and bool(pids)
    specs = service_specs(pids.get("dashboard_port") or 3000)

    for service in specs:
        key = service["key"]
        recorded_pid = pids.get(key)
        candidates = []
        allow_discovery = not registry_exists and not recorded_pid
        if recorded_pid and is_pid_alive(recorded_pid):
            if process_matches_service(service, recorded_pid):
                candidates.append(recorded_pid)
            else:
                # Nunca se mata un PID reutilizado por otro programa. Se elimina del
                # registro para que stop/restart no queden bloqueados para siempre.
                stale.append(key)
                print(f"[SGRS] Aviso: el PID registrado de {service['name']} ya pertenece a otro proceso; se omite.")
        elif recorded_pid:
            stale.append(key)

        # Si el archivo se perdió o quedó incompleto, recuperar solo procesos cuyo
        # cwd y script coinciden exactamente con el servicio SGRS.
        if not candidates and allow_discovery:
            candidates = discover_service_processes(service)
        for pid in candidates:
            stopping[key] = pid

    for pid in stopping.values():
        _signal_process(pid)

    if not _wait_for_processes_to_exit(stopping.values(), 10):
        alive = [pid for pid in stopping.values() if is_pid_alive(pid)]
        for pid in alive:
            _signal_process(pid, force=True)
        if not _wait_for_processes_to_exit(alive, 5):
            remaining = {key: pid for key, pid in stopping.items() if is_pid_alive(pid)}
            save_pids({**remaining, "dashboard_port": pids.get("dashboard_port")} if remaining else {})
            raise RuntimeError("Hay servicios que no terminaron en 15s. Se conservaron sus PIDs; revisa SGRS logs.")

    PID_FILE.unlink(missing_ok=True)
    if stale and not stopping:
        print("[SGRS] [OK] No había procesos SGRS activos; se limpió el registro obsoleto.\n")
    else:
        print("[SGRS] [OK] Los procesos registrados de los servicios terminaron.\n")


def logs_services():
    """Transmite en vivo los logs unificados de la plataforma."""
    if not MAIN_LOG.exists():
        print(f"[SGRS] No se encontró el archivo de logs en {MAIN_LOG}")
        print("Inicia los servicios primero con 'python run.py'")
        return

    print(f"[SGRS] Mostrando logs en vivo desde {MAIN_LOG}")
    print("Presione [Ctrl + C] para salir del visor de logs (los servicios seguirán corriendo).\n")

    if sys.platform != "win32" and shutil.which("tail"):
        try:
            subprocess.run(["tail", "-n", "50", "-f", str(MAIN_LOG)])
        except KeyboardInterrupt:
            print("\n[SGRS] Salida del visor de logs.")
    else:
        try:
            with open(MAIN_LOG, "r", encoding="utf-8", errors="replace") as f:
                f.seek(0, os.SEEK_END)
                while True:
                    line = f.readline()
                    if line:
                        print(line, end="", flush=True)
                    else:
                        time.sleep(0.3)
        except KeyboardInterrupt:
            print("\n[SGRS] Salida del visor de logs.")


def stream_logs_to_output(pipe, prefix: str, log_file=None):
    """Transmite logs hacia la consola y hacia el archivo unificado de logs."""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            clean_line = f"{prefix} {line.rstrip()}"
            if log_file:
                try:
                    log_file.write(clean_line + "\n")
                    log_file.flush()
                except Exception:
                    pass
            try:
                print(clean_line, flush=True)
            except (BrokenPipeError, OSError):
                pass
    except Exception:
        pass
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def ensure_environment():
    """Verifica y prepara el entorno para ejecución en servidor o local.

    - Crea el entorno virtual .venv si no existe.
    - Instala dependencias desde requirements.txt si faltan en el entorno virtual.
    - Asegura permisos estrictos (0o700 / 0o600) en .sgrs-private y sus bases de datos en Linux/POSIX.
    - Si Dashboard/dist no existe y npm está disponible, compila el frontend.
    """
    ensure_supported_python()
    venv_dir = ROOT_DIR / ".venv"
    py_venv = (
        venv_dir
        / ("Scripts" if sys.platform == "win32" else "bin")
        / ("python.exe" if sys.platform == "win32" else "python")
    )

    # 1. Crear entorno virtual si no existe
    if not py_venv.exists():
        print(f"[SGRS] Creando entorno virtual en {venv_dir}...")
        try:
            venv.create(str(venv_dir), with_pip=True)
        except Exception as err:
            print(f"[SGRS] Aviso con venv.create ({err}), intentando vía subprocess...")
            subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        print("[SGRS] [OK] Entorno virtual creado exitosamente.")

    py_exe = get_python_exe()

    # 2. Comprobar dependencias clave
    test_deps_code = "import fastapi, uvicorn, httpx, requests, pydantic_settings; print('DEPS_OK')"
    check_deps = subprocess.run(
        [py_exe, "-c", test_deps_code],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if check_deps.returncode != 0:
        req_file = ROOT_DIR / "requirements.txt"
        if req_file.exists():
            print("[SGRS] Dependencias de Python no detectadas en el entorno virtual. Instalando requirements.txt...")
            subprocess.run([py_exe, "-m", "pip", "install", "-r", str(req_file)], check=True)
            print("[SGRS] [OK] Dependencias instaladas exitosamente.")
        else:
            print("[SGRS] Aviso: requirements.txt no encontrado.")

    # 3. Comprobar permisos seguros de .sgrs-private (Linux / POSIX)
    private_dir = ROOT_DIR / ".sgrs-private"
    if not private_dir.exists():
        try:
            private_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    if private_dir.exists() and sys.platform != "win32":
        try:
            os.chmod(private_dir, 0o700)
            for item in private_dir.rglob("*"):
                if item.is_dir():
                    os.chmod(item, 0o700)
                elif item.is_file():
                    os.chmod(item, 0o600)
        except Exception as err:
            print(f"[SGRS] Aviso al configurar permisos en .sgrs-private: {err}")

    # 4. Comprobar Dashboard/dist
    dash_dir = ROOT_DIR / "Dashboard"
    dash_dist = dash_dir / "dist"
    index_file = dash_dist / "index.html"

    if not index_file.exists():
        npm_bin = shutil.which("npm")
        if sys.platform == "win32" and not npm_bin:
            npm_win = r"C:\Program Files\nodejs\npm.cmd"
            if os.path.exists(npm_win):
                npm_bin = npm_win

        if npm_bin:
            print("[SGRS] Compilado de Dashboard no detectado. Compilando interfaz web frontend...")
            try:
                if not (dash_dir / "node_modules").exists():
                    print("[SGRS] Instalando dependencias de frontend con npm...")
                    subprocess.run([npm_bin, "install"], cwd=str(dash_dir), check=True)
                print("[SGRS] Compilando assets del frontend (npm run build)...")
                subprocess.run([npm_bin, "run", "build"], cwd=str(dash_dir), check=True)
                print("[SGRS] [OK] Dashboard frontend compilado exitosamente.")
            except Exception as err:
                print(f"[SGRS] Aviso: No se pudo compilar el Dashboard automáticamente: {err}")
        else:
            print("[SGRS] Aviso: Dashboard/dist no encontrado y npm no está disponible.")


def start_services(detached: bool = True, dashboard_port=None):
    """Inicia todos los servicios (APIs + Dashboard).

    Si detached=True: se ejecutan en segundo plano totalmente desacoplados de la terminal.
    Si detached=False: se ejecutan en primer plano transmitiendo logs a la consola actual.
    """
    # Comprobar permisos de red antes de crear procesos o modificar el registro.
    is_port_in_use(8000)
    ensure_environment()
    validate_configured_tls_bundles()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    py_exe = get_python_exe()
    env = get_env(py_exe)
    display_host = os.environ.get("SGRS_SERVER_IP", "192.168.38.250")

    dash_port = get_dashboard_port() if dashboard_port is None else get_dashboard_port(dashboard_port)
    services = service_specs(dash_port)
    env["PORT"] = str(dash_port)
    env["DASHBOARD_PORT"] = str(dash_port)

    ensure_inventory_config(py_exe)

    pids = load_pids()
    fixed_qr_port = PERMANENT_QR_PORT
    if pids.get("dashboard_port") != fixed_qr_port and is_pid_alive(pids.get("dashboard")):
        raise RuntimeError(
            f"El Dashboard activo usa el puerto {pids.get('dashboard_port')}, pero el QR permanente apunta al {fixed_qr_port}. "
            "Ejecuta SGRS restart para sincronizarlo."
        )
    dashboard_service = next(service for service in services if service["key"] == "dashboard")
    if is_port_in_use(fixed_qr_port):
        dashboard_pid = pids.get("dashboard")
        registered_dashboard = (
            isinstance(dashboard_pid, int)
            and is_pid_alive(dashboard_pid)
            and pids.get("dashboard_port") == fixed_qr_port
            and process_matches_service(dashboard_service, dashboard_pid)
        )
        discovered_dashboard = bool(discover_service_processes(dashboard_service))
        if not registered_dashboard and not discovered_dashboard:
            raise RuntimeError(
                f"El puerto {fixed_qr_port} del QR permanente está ocupado por otro proceso; "
                "libéralo para iniciar SGRS sin cambiar las etiquetas."
            )

    # Si todos los servicios ya están activos, mostrar estado y no duplicar
    if all(service_ready(service) for service in services):
        print("\n[SGRS] Los servicios ya están en ejecución:")
        status_services()
        return

    # Recuperar un arranque parcial conservando los componentes ya registrados.
    existing = {}
    cleaned_pids = dict(pids)
    for service in services:
        pid = pids.get(service["key"])
        alive = bool(pid and is_pid_alive(pid))
        occupied = is_port_in_use(service["port"])
        if alive:
            try:
                validate_registered_process(service, pid)
            except RuntimeError:
                cleaned_pids.pop(service["key"], None)
                recovered = discover_service_processes(service)
                if recovered:
                    recovered_pid = recovered[0]
                    existing[service["key"]] = RegisteredProcess(recovered_pid)
                    cleaned_pids[service["key"]] = recovered_pid
                elif occupied:
                    raise RuntimeError(f"El puerto de {service['name']} ({service['port']}) está ocupado por un proceso no registrado. No se modificó.")
            else:
                existing[service["key"]] = RegisteredProcess(pid)
        elif occupied:
            recovered = discover_service_processes(service)
            if recovered:
                recovered_pid = recovered[0]
                existing[service["key"]] = RegisteredProcess(recovered_pid)
                cleaned_pids[service["key"]] = recovered_pid
            else:
                raise RuntimeError(f"El puerto de {service['name']} ({service['port']}) está ocupado por un proceso no registrado. No se modificó.")
    if cleaned_pids != pids:
        save_pids(cleaned_pids)
    if existing and not detached:
        raise RuntimeError("Hay servicios registrados en ejecución. Usa SGRS para completar el arranque o SGRS restart para reiniciar todos.")
    if existing:
        print("[SGRS] Recuperando el arranque parcial; se conservan los servicios activos.")

    forti_dir = ROOT_DIR / "API Forti"
    omni_dir = ROOT_DIR / "API Omni"
    inventory_dir = ROOT_DIR / "API Inventarios"
    server_py = ROOT_DIR / "server.py"

    if detached:
        # ==============================================================
        # MODO SEGUNDO PLANO (DAEMON) - Seguro para cerrar la terminal
        # ==============================================================
        log_out = open(MAIN_LOG, "a", encoding="utf-8")
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        log_out.write(f"\n\n{'='*72}\n[SGRS] Inicio de sesión en segundo plano: {timestamp}\n{'='*72}\n")
        log_out.flush()

        popen_kwargs = {
            "stdout": log_out,
            "stderr": subprocess.STDOUT,
            "env": env,
        }
        if sys.platform != "win32":
            popen_kwargs["start_new_session"] = True
        else:
            popen_kwargs.update(windows_no_console_options())

        env_forti = {**api_environment(env, dash_port, "forti"), "PORT": "8001"}
        env_omni = {**api_environment(env, dash_port, "omni"), "PORT": "8000"}
        env_inventory = {**api_environment(env, dash_port, "inventarios"), "INVENTARIOS_PORT": str(get_inventory_port())}
        env_dash = dashboard_environment(env, dash_port)

        def launch(key, cwd, entry, service_env):
            if key in existing:
                return existing[key]
            return subprocess.Popen([py_exe, entry], cwd=str(cwd), **{**popen_kwargs, "env": service_env})

        proc_forti = launch("api_forti", forti_dir, "run.py", env_forti)
        proc_omni = launch("api_omni", omni_dir, "run.py", env_omni)
        proc_inventory = launch("api_inventarios", inventory_dir, "run.py", env_inventory)
        proc_dash = launch("dashboard", ROOT_DIR, "server.py", env_dash) if server_py.exists() else None

        # Guardar PIDs registrados
        save_pids({
            "api_forti": proc_forti.pid,
            "api_omni": proc_omni.pid,
            "api_inventarios": proc_inventory.pid,
            "dashboard": proc_dash.pid if proc_dash else None,
            "dashboard_port": dash_port if proc_dash else None,
        })

        processes = {"api_forti": proc_forti, "api_omni": proc_omni,
                     "api_inventarios": proc_inventory, "dashboard": proc_dash}
        try:
            wait_for_services(services, processes)
        except (RuntimeError, PermissionError):
            print("[SGRS] Arranque incompleto. El registro conserva los procesos para SGRS status/stop.")
            raise
        finally:
            log_out.close()

        print("=" * 72)
        print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
        print("          Plataforma iniciada con éxito en segundo plano")
        print("=" * 72)
        print("  [1] API Alcatel OmniVista 2500:")
        print(f"      - Endpoint base:   http://{display_host}:8000")
        print(f"      - Documentación:   http://{display_host}:8000/scalar (o /docs)")
        print(f"      - Liveness Probe:  http://{display_host}:8000/health")
        print()
        print("  [2] API Fortinet FortiGate:")
        print(f"      - Endpoint base:   http://{display_host}:8001")
        print(f"      - Documentación:   http://{display_host}:8001/scalar")
        print(f"      - Liveness Probe:  http://{display_host}:8001/health")
        print()
        print("  [3] API Inventarios:")
        print(f"      - Documentación:   http://{display_host}:{get_inventory_port()}/scalar")
        print(f"      - Liveness Probe:  http://{display_host}:{get_inventory_port()}/health")
        print()
        print(f"  [4] Dashboard Web UI (React / Tailwind / Puerto {dash_port}):")
        print(f"      - Interfaz Gráfica: http://{display_host}:{dash_port}")
        print("=" * 72)
        print("  [OK] Los procesos se ejecutan desacoplados de la terminal.")
        print("       ¡Ya puedes cerrar esta consola sin que los servicios se detengan!")
        print()
        print("  Comandos rápidos:")
        print("    python run.py status    -> Verificar el estado de los servicios")
        print("    python run.py logs      -> Ver logs unificados en tiempo real")
        print("    python run.py stop      -> Detener todos los servicios")
        print("    python run.py restart   -> Reiniciar toda la plataforma")
        print("=" * 72 + "\n")
        return

    # ==============================================================
    # MODO PRIMER PLANO (FOREGROUND)
    # ==============================================================
    log_file = open(MAIN_LOG, "a", encoding="utf-8")
    print("=" * 72)
    print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
    print("           Iniciando Plataforma Completa (APIs + UI)")
    print("=" * 72)
    print(f"  [1] API Alcatel OmniVista 2500:  http://{display_host}:8000")
    print(f"  [2] API Fortinet FortiGate:      http://{display_host}:8001")
    print(f"  [3] API Inventarios:             http://{display_host}:{get_inventory_port()}/scalar")
    print(f"  [4] Dashboard Web UI:            http://{display_host}:{dash_port}")
    print("=" * 72)
    print("  Presione [Ctrl + C] para detener todos los servicios.")
    print("=" * 72 + "\n")

    popen_fg = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
        "env": env,
    }
    if sys.platform != "win32":
        popen_fg["start_new_session"] = True
    else:
        popen_fg.update(windows_no_console_options())

    env_forti = {**api_environment(env, dash_port, "forti"), "PORT": "8001"}
    env_omni = {**api_environment(env, dash_port, "omni"), "PORT": "8000"}
    env_inventory = {**api_environment(env, dash_port, "inventarios"), "INVENTARIOS_PORT": str(get_inventory_port())}
    env_dash = dashboard_environment(env, dash_port)

    proc_forti = subprocess.Popen([py_exe, "run.py"], cwd=str(forti_dir), **{**popen_fg, "env": env_forti})
    proc_omni = subprocess.Popen([py_exe, "run.py"], cwd=str(omni_dir), **{**popen_fg, "env": env_omni})
    proc_inventory = subprocess.Popen([py_exe, "run.py"], cwd=str(inventory_dir), **{**popen_fg, "env": env_inventory})
    proc_dash = None
    if server_py.exists():
        try:
            proc_dash = subprocess.Popen([py_exe, "server.py"], cwd=str(ROOT_DIR), **{**popen_fg, "env": env_dash})
        except Exception as e:
            print(f"[SGRS] Aviso: No se pudo arrancar el Dashboard en server.py: {e}")

    save_pids({
        "api_forti": proc_forti.pid,
        "api_omni": proc_omni.pid,
        "api_inventarios": proc_inventory.pid,
        "dashboard": proc_dash.pid if proc_dash else None,
        "dashboard_port": dash_port if proc_dash else None,
    })

    t_forti = threading.Thread(target=stream_logs_to_output, args=(proc_forti.stdout, "[API-FORTI]", log_file), daemon=True)
    t_omni = threading.Thread(target=stream_logs_to_output, args=(proc_omni.stdout, "[API-OMNI] ", log_file), daemon=True)
    t_inventory = threading.Thread(target=stream_logs_to_output, args=(proc_inventory.stdout, "[INVENTARIOS]", log_file), daemon=True)
    t_inventory.start()
    t_forti.start()
    t_omni.start()

    if proc_dash and proc_dash.stdout:
        t_dash = threading.Thread(target=stream_logs_to_output, args=(proc_dash.stdout, "[DASHBOARD]", log_file), daemon=True)
        t_dash.start()

    # Si la terminal se cierra (SIGHUP), no terminar los subprocesos
    if hasattr(signal, "SIGHUP"):
        try:
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
        except Exception:
            pass

    def sig_exit(signum, frame):
        sys.exit(0)

    try:
        signal.signal(signal.SIGINT, sig_exit)
        signal.signal(signal.SIGTERM, sig_exit)
    except Exception:
        pass

    try:
        wait_for_services(services, {"api_forti": proc_forti, "api_omni": proc_omni,
                                     "api_inventarios": proc_inventory, "dashboard": proc_dash})
        print("[SGRS] Los cuatro servicios están listos.")
        while True:
            if proc_forti.poll() is not None:
                print(f"\n[ALERTA] API Forti se detuvo con código {proc_forti.returncode}.")
                break
            if proc_inventory.poll() is not None:
                print(f"API Inventarios se detuvo con código {proc_inventory.returncode}.")
                break
            if proc_omni.poll() is not None:
                print(f"\n[ALERTA] API Omni se detuvo con código {proc_omni.returncode}.")
                break
            if proc_dash and proc_dash.poll() is not None:
                print(f"\n[ALERTA] Dashboard se detuvo con código {proc_dash.returncode}.")
                break
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        stop_services()
        log_file.close()


def main():
    cmd = sys.argv[1].lower().strip("-") if len(sys.argv) > 1 else "start"

    if cmd == "install":
        print("=" * 72)
        print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
        print("             Configuración y Preparación del Entorno")
        print("=" * 72)
        ensure_environment()
        validate_configured_tls_bundles()
        ensure_inventory_config(get_python_exe())
        installed = install_launchers()
        print("\n[SGRS] [OK] El entorno está listo.")
        if installed:
            print("[SGRS] [OK] Comandos instalados: " + ", ".join(str(path) for path in installed))
        if sys.platform == "win32":
            path_added = ensure_windows_user_path(LAUNCHER_DIR)
            if path_added:
                print(f"[SGRS] [OK] {LAUNCHER_DIR} añadido al PATH global de este usuario.")
                print("[SGRS] Cierra y vuelve a abrir la aplicación de terminal para cargar el PATH actualizado.")
            else:
                print("[SGRS] [OK] El comando SGRS ya está disponible en el PATH de este usuario.")
            print("[SGRS] Iniciando los cuatro servicios en segundo plano...")
            start_services(detached=True)
            print("[SGRS] [OK] Instalación completa; SGRS y sgrs ya pueden usarse desde cualquier terminal.\n")
        else:
            print("       Inicia los servicios ejecutando: SGRS\n")
    elif cmd in ("setup", "init"):
        print("=" * 72)
        print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
        print("             Configuración y Preparación del Entorno")
        print("=" * 72)
        ensure_environment()
        print("\n[SGRS] [OK] El entorno está listo.")
        print("       Para instalar el comando global usa: python run.py install\n")
    elif cmd in ("stop", "down", "kill"):
        stop_services()
    elif cmd in ("status", "ps"):
        status_services()
    elif cmd in ("logs", "log"):
        logs_services()
    elif cmd in ("restart", "reload"):
        # No detener servicios si este entorno no puede comprobar su reinicio.
        is_port_in_use(8000)
        current = load_pids()
        previous_dashboard_port = current.get("dashboard_port")
        stop_services()
        ports = [8000, 8001, get_inventory_port()]
        if isinstance(previous_dashboard_port, int):
            ports.append(previous_dashboard_port)
        wait_for_ports_free(ports)
        start_services(detached=True, dashboard_port=previous_dashboard_port)
    elif cmd in ("open", "abrir"):
        pids = load_pids()
        port = pids.get("dashboard_port") or int(os.environ.get("DASHBOARD_PORT", "3000"))
        webbrowser.open(f"http://localhost:{port}")
    elif cmd in ("foreground", "f", "fg"):
        start_services(detached=False)
    elif cmd in ("start", "daemon", "d", "bg", "run"):
        start_services(detached=True)
    elif cmd in ("help", "h"):
        print("Uso: SGRS [install|start|stop|status|logs|restart|setup|open|--foreground]")
        print("Equivalente: python run.py <comando>")
        print("Servicios: OmniVista (8000), FortiGate (8001), Inventarios (8002), Dashboard (origen QR fijo)")
        print("  start          Inicia la plataforma en segundo plano (por defecto)")
        print("  install        Prepara dependencias e instala SGRS/sgrs; en Windows también inicia los servicios")
        print("  setup          Prepara el entorno virtual, dependencias y permisos")
        print("  stop           Detiene todos los servicios y libera los puertos")
        print("  status         Muestra el estado de salud de los servicios")
        print("  logs           Muestra los logs unificados en tiempo real")
        print("  restart        Detiene e inicia nuevamente los servicios")
        print("  open           Abre el Dashboard en su puerto registrado")
        print("  --foreground   Ejecuta mostrando los logs en la terminal actual")
    else:
        raise RuntimeError(f"Comando desconocido: {cmd}. Consulta SGRS help.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as exc:
        print(f"[SGRS] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
