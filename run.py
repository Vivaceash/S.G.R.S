import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

# Configurar salida estándar con UTF-8 para Windows PowerShell
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def stream_logs(pipe, prefix: str):
    """Lee y transmite los logs de un subproceso con prefijo identificador."""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            print(f"{prefix} {line.rstrip()}", flush=True)
    except Exception:
        pass
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def main():
    root_dir = Path(__file__).resolve().parent
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    # Asegurar que nodejs esté en el PATH para este proceso
    node_path = r"C:\Program Files\nodejs"
    if os.path.exists(node_path) and node_path not in env.get("PATH", ""):
        env["PATH"] = f"{node_path};" + env.get("PATH", "")

    print("=" * 72)
    print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
    print("           Iniciando Plataforma Completa (APIs + UI)")
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
    print("  [3] Dashboard Web UI (React + TypeScript + Vite):")
    print("      - Interfaz Gráfica: http://localhost:5173")
    print("=" * 72)
    print("  Presione [Ctrl + C] en esta consola para detener todos los servicios.")
    print("=" * 72 + "\n")

    # Iniciar API Forti (Puerto 8001)
    forti_dir = root_dir / "API Forti"
    proc_forti = subprocess.Popen(
        [sys.executable, "run.py"],
        cwd=str(forti_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )

    # Iniciar API Omni (Puerto 8000)
    omni_dir = root_dir / "API Omni"
    proc_omni = subprocess.Popen(
        [sys.executable, "run.py"],
        cwd=str(omni_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )

    # Iniciar Dashboard React Vite (Puerto 5173)
    dash_dir = root_dir / "Dashboard"
    npm_exe = r"C:\Program Files\nodejs\npm.cmd" if os.path.exists(r"C:\Program Files\nodejs\npm.cmd") else "npm"
    proc_dash = None
    if (dash_dir / "package.json").exists():
        try:
            proc_dash = subprocess.Popen(
                [npm_exe, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
                cwd=str(dash_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
                shell=(sys.platform == "win32"),
            )
        except Exception as e:
            print(f"[SGRS] Aviso: No se pudo arrancar el Dashboard en Vite: {e}")

    # Hilos para streaming en vivo de logs
    t_forti = threading.Thread(
        target=stream_logs,
        args=(proc_forti.stdout, "[API-FORTI]"),
        daemon=True,
    )
    t_omni = threading.Thread(
        target=stream_logs,
        args=(proc_omni.stdout, "[API-OMNI] "),
        daemon=True,
    )
    t_forti.start()
    t_omni.start()

    if proc_dash and proc_dash.stdout:
        t_dash = threading.Thread(
            target=stream_logs,
            args=(proc_dash.stdout, "[DASHBOARD]"),
            daemon=True,
        )
        t_dash.start()

    def terminate_subprocesses():
        print("\n\n[SGRS] Deteniendo servicios de la plataforma...")
        services = [("API Forti", proc_forti), ("API Omni", proc_omni)]
        if proc_dash:
            services.append(("Dashboard", proc_dash))

        for name, proc in services:
            try:
                if proc.poll() is None:
                    if sys.platform == "win32":
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                    else:
                        proc.terminate()
                        try:
                            proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            proc.kill()
            except Exception as e:
                print(f"[SGRS] Error al detener {name}: {e}")
        print("[SGRS] Todos los servicios detenidos correctamente. Salida limpia.\n")

    try:
        # Monitorear estado de los procesos
        while True:
            if proc_forti.poll() is not None:
                print(f"\n[ALERTA] API Forti se detuvo inesperadamente con código {proc_forti.returncode}.")
                break
            if proc_omni.poll() is not None:
                print(f"\n[ALERTA] API Omni se detuvo inesperadamente con código {proc_omni.returncode}.")
                break
            if proc_dash and proc_dash.poll() is not None:
                print(f"\n[ALERTA] Dashboard se detuvo inesperadamente con código {proc_dash.returncode}.")
                break
            threading.Event().wait(1)
    except KeyboardInterrupt:
        pass
    finally:
        terminate_subprocesses()


if __name__ == "__main__":
    main()
