import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

# Configurar salida estándar con UTF-8 para PowerShell / Bash
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parent
PID_FILE = ROOT_DIR / ".sgrs_pids.json"
LOG_DIR = ROOT_DIR / "logs"
MAIN_LOG = LOG_DIR / "sgrs.log"


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Verifica si un puerto TCP ya se encuentra en escucha."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


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
    env_port = os.environ.get("DASHBOARD_PORT") or os.environ.get("PORT")
    if env_port and env_port.isdigit():
        return int(env_port)
    pids = load_pids()
    # Persistir el puerto evita que un dashboard ya escuchando en 3000 sea
    # interpretado como una colisión y se reporte erróneamente como 3001.
    registered_port = pids.get("dashboard_port")
    if pids.get("dashboard") and isinstance(registered_port, int) and registered_port > 0:
        return registered_port
    # Compatibilidad con registros generados antes de dashboard_port.
    if pids.get("dashboard"):
        if is_port_in_use(3000):
            return 3000
        if is_port_in_use(3001):
            return 3001
    # Probar si el puerto 3000 está disponible para bind
    s = socket.socket()
    try:
        s.bind(("0.0.0.0", 3000))
        s.close()
        return 3000
    except Exception:
        return 3001


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


def status_services():
    """Muestra el estado actual de los 3 servicios de S.G.R.S."""
    omni_ok = is_port_in_use(8000)
    forti_ok = is_port_in_use(8001)
    dash_port = get_dashboard_port()
    dash_ok = is_port_in_use(dash_port)

    pids = load_pids()
    pid_omni = f"(PID: {pids.get('api_omni')})" if pids.get("api_omni") else ""
    pid_forti = f"(PID: {pids.get('api_forti')})" if pids.get("api_forti") else ""
    pid_dash = f"(PID: {pids.get('dashboard')})" if pids.get("dashboard") else ""

    print("=" * 72)
    print("           ESTADO DE LOS SERVICIOS - S.G.R.S.")
    print("=" * 72)
    print(f"  [1] API OmniVista 2500 (8000):  {'[ACTIVO]' if omni_ok else '[DETENIDO]'} {pid_omni}")
    print(f"      -> URL: http://localhost:8000 (Docs: /scalar o /docs)")
    print()
    print(f"  [2] API FortiGate (8001):       {'[ACTIVO]' if forti_ok else '[DETENIDO]'} {pid_forti}")
    print(f"      -> URL: http://localhost:8001 (Docs: /scalar)")
    print()
    print(f"  [3] Dashboard Web UI ({dash_port}):    {'[ACTIVO]' if dash_ok else '[DETENIDO]'} {pid_dash}")
    print(f"      -> URL: http://localhost:{dash_port}")
    print("=" * 72)

    if omni_ok or forti_ok or dash_ok:
        print("  Servicios en ejecución. Comandos disponibles:")
        print("    python run.py logs     -> Ver logs en vivo")
        print("    python run.py stop     -> Detener todos los servicios")
        print("    python run.py restart  -> Reiniciar los servicios")
    else:
        print("  Todos los servicios están detenidos.")
        print("  Para iniciar: python run.py (o python run.py start)")
    print("=" * 72 + "\n")


def stop_services():
    """Detiene ordenadamente todos los procesos de la plataforma y libera puertos."""
    print("\n[SGRS] Deteniendo servicios de la plataforma...")
    pids = load_pids()
    if pids:
        for name, pid in pids.items():
            if not pid:
                continue
            try:
                if sys.platform == "win32":
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGTERM)
                    except Exception:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except Exception:
                            pass
            except Exception:
                pass

    if PID_FILE.exists():
        try:
            PID_FILE.unlink(missing_ok=True)
        except Exception:
            pass

    # Garantizar que todos los puertos queden liberados
    dash_port = get_dashboard_port()
    free_ports_if_busy([8000, 8001, dash_port], silent=True)
    print("[SGRS] [OK] Todos los servicios detenidos y puertos liberados correctamente.\n")


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


def start_services(detached: bool = True):
    """Inicia todos los servicios (APIs + Dashboard).

    Si detached=True: se ejecutan en segundo plano totalmente desacoplados de la terminal.
    Si detached=False: se ejecutan en primer plano transmitiendo logs a la consola actual.
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    py_exe = get_python_exe()
    npm_exe = get_npm_exe()
    env = get_env(py_exe)

    dash_port = get_dashboard_port()
    env["PORT"] = str(dash_port)

    # Si todos los servicios ya están activos, mostrar estado y no duplicar
    if is_port_in_use(8000) and is_port_in_use(8001) and is_port_in_use(dash_port):
        print("\n[SGRS] Los servicios ya están en ejecución:")
        status_services()
        return

    # Limpiar puertos huérfanos o colgados previamente
    free_ports_if_busy([8000, 8001, dash_port])

    forti_dir = ROOT_DIR / "API Forti"
    omni_dir = ROOT_DIR / "API Omni"
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
        env_dash = {**env, "PORT": str(dash_port), "DASHBOARD_PORT": str(dash_port)}

        # Iniciar API Forti (Puerto 8001)
        proc_forti = subprocess.Popen([py_exe, "run.py"], cwd=str(forti_dir), **{**popen_kwargs, "env": env_forti})

        # Iniciar API Omni (Puerto 8000)
        proc_omni = subprocess.Popen([py_exe, "run.py"], cwd=str(omni_dir), **{**popen_kwargs, "env": env_omni})

        # Iniciar Dashboard Server (Puerto dinámico)
        proc_dash = None
        if server_py.exists():
            try:
                proc_dash = subprocess.Popen([py_exe, "server.py"], cwd=str(ROOT_DIR), **{**popen_kwargs, "env": env_dash})
            except Exception as e:
                print(f"[SGRS] Aviso: No se pudo arrancar el Dashboard en server.py: {e}")

        # Guardar PIDs registrados
        save_pids({
            "api_forti": proc_forti.pid,
            "api_omni": proc_omni.pid,
            "dashboard": proc_dash.pid if proc_dash else None,
            "dashboard_port": dash_port if proc_dash else None,
        })

        # Breve pausa para asegurar arranque
        time.sleep(1.5)

        print("=" * 72)
        print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
        print("          Plataforma iniciada con éxito en segundo plano")
        print("=" * 72)
        print("  [1] API Alcatel OmniVista 2500:")
        print("      - Endpoint base:   http://localhost:8000")
        print("      - Documentación:   http://localhost:8000/scalar (o /docs)")
        print("      - Liveness Probe:  http://localhost:8000/health")
        print()
        print("  [2] API Fortinet FortiGate:")
        print("      - Endpoint base:   http://localhost:8001")
        print("      - Documentación:   http://localhost:8001/scalar")
        print("      - Liveness Probe:  http://localhost:8001/health")
        print()
        print(f"  [3] Dashboard Web UI (HTML5 / Vanilla JS / Puerto {dash_port}):")
        print(f"      - Interfaz Gráfica: http://localhost:{dash_port}")
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
    print("  [1] API Alcatel OmniVista 2500:  http://localhost:8000")
    print("  [2] API Fortinet FortiGate:      http://localhost:8001")
    print(f"  [3] Dashboard Web UI:            http://localhost:{dash_port}")
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
    env_dash = {**env, "PORT": str(dash_port), "DASHBOARD_PORT": str(dash_port)}

    proc_forti = subprocess.Popen([py_exe, "run.py"], cwd=str(forti_dir), **{**popen_fg, "env": env_forti})
    proc_omni = subprocess.Popen([py_exe, "run.py"], cwd=str(omni_dir), **{**popen_fg, "env": env_omni})
    proc_dash = None
    if server_py.exists():
        try:
            proc_dash = subprocess.Popen([py_exe, "server.py"], cwd=str(ROOT_DIR), **{**popen_fg, "env": env_dash})
        except Exception as e:
            print(f"[SGRS] Aviso: No se pudo arrancar el Dashboard en server.py: {e}")

    save_pids({
        "api_forti": proc_forti.pid,
        "api_omni": proc_omni.pid,
        "dashboard": proc_dash.pid if proc_dash else None,
        "dashboard_port": dash_port if proc_dash else None,
    })

    t_forti = threading.Thread(target=stream_logs_to_output, args=(proc_forti.stdout, "[API-FORTI]", log_file), daemon=True)
    t_omni = threading.Thread(target=stream_logs_to_output, args=(proc_omni.stdout, "[API-OMNI] ", log_file), daemon=True)
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
        while True:
            if proc_forti.poll() is not None:
                print(f"\n[ALERTA] API Forti se detuvo con código {proc_forti.returncode}.")
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


def main():
    cmd = sys.argv[1].lower().strip("-") if len(sys.argv) > 1 else "start"

    if cmd in ("stop", "down", "kill"):
        stop_services()
    elif cmd in ("status", "ps"):
        status_services()
    elif cmd in ("logs", "log"):
        logs_services()
    elif cmd in ("restart", "reload"):
        stop_services()
        time.sleep(1)
        start_services(detached=True)
    elif cmd in ("foreground", "f", "fg"):
        start_services(detached=False)
    elif cmd in ("start", "daemon", "d", "bg", "run"):
        start_services(detached=True)
    elif cmd in ("help", "h"):
        print("Uso: python run.py [start|stop|status|logs|restart|--foreground]")
        print("  start          Inicia la plataforma en segundo plano (por defecto)")
        print("  stop           Detiene todos los servicios y libera los puertos")
        print("  status         Muestra el estado de salud de los servicios")
        print("  logs           Muestra los logs unificados en tiempo real")
        print("  restart        Detiene e inicia nuevamente los servicios")
        print("  --foreground   Ejecuta mostrando los logs en la terminal actual")
    else:
        # Por defecto, iniciar en segundo plano para poder cerrar la terminal
        start_services(detached=True)


if __name__ == "__main__":
    main()
