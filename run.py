import json
import errno
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import venv
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

# Configurar salida estándar con UTF-8 para PowerShell / Bash
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parent

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


def get_dashboard_port() -> int:
    """Retorna el puerto del Dashboard (3000 o 3001 si 3000 está ocupado por un servicio del sistema)."""
    pids = load_pids()
    dash_pid = pids.get("dashboard")
    registered_port = pids.get("dashboard_port")

    # Si hay un dashboard registrado y su proceso sigue realmente vivo, reutilizar ese puerto
    if isinstance(dash_pid, int) and is_pid_alive(dash_pid):
        if isinstance(registered_port, int) and registered_port > 0:
            return registered_port
        # Compatibilidad con registros generados antes de dashboard_port
        if is_port_in_use(3000):
            return 3000
        if is_port_in_use(3001):
            return 3001

    # Si no está vivo o no hay registro previo, evalúa el puerto preferido configurado (DASHBOARD_PORT o 3000)
    env_port = os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT")
    preferred_port = int(env_port) if (env_port and env_port.isdigit()) else 3000

    candidate_ports = [preferred_port]
    for alt in (3001, 3002):
        if alt not in candidate_ports:
            candidate_ports.append(alt)

    for p in candidate_ports:
        if is_port_in_use(p):
            continue
        s = socket.socket()
        try:
            s.bind(("0.0.0.0", p))
            s.close()
            return p
        except Exception:
            continue
    return candidate_ports[0]


def local_network_ip() -> str:
    """Obtiene la IPv4 usada para alcanzar la red institucional."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("10.255.255.255", 1))
            return probe.getsockname()[0]
        except OSError:
            return "127.0.0.1"


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


def save_pids(pids: dict):
    """Guarda los identificadores de proceso para poder gestionarlos después."""
    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            json.dump(pids, f, indent=2)
    except Exception:
        pass


def load_pids() -> dict:
    """Carga los PIDs previamente registrados."""
    if PID_FILE.exists():
        try:
            with open(PID_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def get_inventory_port():
    return int(os.environ.get("INVENTARIOS_PORT", "8002"))


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


def validate_registered_process(service, pid):
    """Verifica que un PID vivo pertenece al componente registrado."""
    if sys.platform != "linux":
        return
    try:
        cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
        args = Path(f"/proc/{pid}/cmdline").read_bytes().decode().split("\0")
        entry_matches = any(Path(arg).name == service["entry"] for arg in args if arg)
        if cwd != service["cwd"].resolve() or not entry_matches:
            raise RuntimeError(f"El PID de {service['name']} no corresponde al proceso registrado; no se detuvo.")
    except OSError:
        raise RuntimeError(f"No se puede verificar el PID de {service['name']}; no se detuvo.") from None


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
                return True
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
        suffix = "/scalar" if service["key"] != "dashboard" else ""
        print(f"  [{index}] {service['name']} ({service['port']}): [{state}] (PID registrado: {pid})")
        print(f"      -> http://{display_host}:{service['port']}{suffix}")
    print("  Comandos: SGRS | SGRS status | SGRS logs | SGRS stop | SGRS restart")
    print("=" * 72 + "\n")


def stop_services():
    """Detiene únicamente los procesos registrados de esta plataforma."""
    print("\n[SGRS] Deteniendo servicios de la plataforma...")
    pids = load_pids()
    stopping = {}
    for service in service_specs(pids.get("dashboard_port") or 3000):
        pid = pids.get(service["key"])
        if not pid or not is_pid_alive(pid):
            continue
        validate_registered_process(service, pid)
        stopping[service["key"]] = pid

    for name, pid in stopping.items():
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/PID", str(pid)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                group = os.getpgid(pid)
                if group == pid and group != os.getpgrp():
                    os.killpg(group, signal.SIGTERM)
                else:
                    os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    deadline = time.monotonic() + 15
    while any(is_pid_alive(pid) for pid in stopping.values()):
        if time.monotonic() >= deadline:
            raise RuntimeError("Hay servicios que no terminaron en 15s. Se conservaron sus PIDs; revisa SGRS logs.")
        time.sleep(0.2)

    PID_FILE.unlink(missing_ok=True)
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


def start_services(detached: bool = True):
    """Inicia todos los servicios (APIs + Dashboard).

    Si detached=True: se ejecutan en segundo plano totalmente desacoplados de la terminal.
    Si detached=False: se ejecutan en primer plano transmitiendo logs a la consola actual.
    """
    # Comprobar permisos de red antes de crear procesos o modificar el registro.
    is_port_in_use(8000)
    ensure_environment()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    py_exe = get_python_exe()
    env = get_env(py_exe)
    display_host = os.environ.get("SGRS_SERVER_IP", "192.168.38.250")

    dash_port = get_dashboard_port()
    services = service_specs(dash_port)
    env["PORT"] = str(dash_port)

    ensure_inventory_config(py_exe)

    # Si todos los servicios ya están activos, mostrar estado y no duplicar
    if all(service_ready(service) for service in services):
        print("\n[SGRS] Los servicios ya están en ejecución:")
        status_services()
        return

    # Recuperar un arranque parcial conservando los componentes ya registrados.
    pids = load_pids()
    existing = {}
    for service in services:
        pid = pids.get(service["key"])
        alive = bool(pid and is_pid_alive(pid))
        occupied = is_port_in_use(service["port"])
        if alive:
            validate_registered_process(service, pid)
            existing[service["key"]] = RegisteredProcess(pid)
        elif occupied:
            raise RuntimeError(f"El puerto de {service['name']} ({service['port']}) está ocupado por un proceso no registrado. No se modificó.")
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
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)

        env_forti = {**env, "PORT": "8001"}
        env_omni = {**env, "PORT": "8000"}
        env_inventory = {**env, "INVENTARIOS_PORT": str(get_inventory_port())}
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

    env_forti = {**env, "PORT": "8001"}
    env_omni = {**env, "PORT": "8000"}
    env_inventory = {**env, "INVENTARIOS_PORT": str(get_inventory_port())}
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

    if cmd in ("install", "setup", "init"):
        print("=" * 72)
        print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
        print("             Configuración y Preparación del Entorno")
        print("=" * 72)
        ensure_environment()
        print("\n[SGRS] [OK] El entorno está listo.")
        print("       Inicia los servicios ejecutando: python run.py\n")
    elif cmd in ("stop", "down", "kill"):
        stop_services()
    elif cmd in ("status", "ps"):
        status_services()
    elif cmd in ("logs", "log"):
        logs_services()
    elif cmd in ("restart", "reload"):
        # No detener servicios si este entorno no puede comprobar su reinicio.
        is_port_in_use(8000)
        stop_services()
        start_services(detached=True)
    elif cmd in ("open", "abrir"):
        pids = load_pids()
        port = pids.get("dashboard_port") or int(os.environ.get("DASHBOARD_PORT", "3000"))
        webbrowser.open(f"http://localhost:{port}")
    elif cmd in ("foreground", "f", "fg"):
        start_services(detached=False)
    elif cmd in ("start", "daemon", "d", "bg", "run"):
        start_services(detached=True)
    elif cmd in ("help", "h"):
        print("Uso: SGRS [start|stop|status|logs|restart|setup|open|--foreground]")
        print("Equivalente: python run.py <comando>")
        print("Servicios: OmniVista (8000), FortiGate (8001), Inventarios (8002), Dashboard (3000 o alternativo)")
        print("  start          Inicia la plataforma en segundo plano (por defecto)")
        print("  setup/install  Prepara el entorno virtual, dependencias y permisos")
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
