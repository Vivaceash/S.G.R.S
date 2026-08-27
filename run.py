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

    print("=" * 72)
    print("      S.G.R.S. - Sistema de Gestión de Redes y Seguridad")
    print("            Iniciando Microservicios de Integración")
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
    print("=" * 72)
    print("  Presione [Ctrl + C] en esta consola para detener ambos servicios.")
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

    def terminate_subprocesses():
        print("\n\n[SGRS] Deteniendo microservicios de API...")
        for name, proc in [("API Forti", proc_forti), ("API Omni", proc_omni)]:
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
        print("[SGRS] Servicios detenidos correctamente. Salida limpia.\n")

    try:
        # Monitorear estado de ambos procesos
        while True:
            # Si alguno termina inesperadamente
            if proc_forti.poll() is not None:
                print(f"\n[ALERTA] API Forti se detuvo inesperadamente con código {proc_forti.returncode}.")
                break
            if proc_omni.poll() is not None:
                print(f"\n[ALERTA] API Omni se detuvo inesperadamente con código {proc_omni.returncode}.")
                break
            threading.Event().wait(1)
    except KeyboardInterrupt:
        pass
    finally:
        terminate_subprocesses()


if __name__ == "__main__":
    main()
