import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def run_suite(name: str, cwd: str) -> int:
    print("=" * 60)
    print(f"[*] Ejecutando pruebas para: {name} (en ./{cwd})")
    print("=" * 60)
    cmd = [sys.executable, "-m", "pytest", "tests", "-v"]
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode == 0:
        print(f"[OK] {name}: Todas las pruebas pasaron exitosamente.\n")
    else:
        print(f"[FAIL] {name}: Fallaron algunas pruebas (Código de salida: {result.returncode}).\n")
    return result.returncode


def main():
    print("\n" + "#" * 60)
    print("  SUITE UNIFICADA DE PRUEBAS AUTOMATIZADAS - S.G.R.S.")
    print("#" * 60 + "\n")

    code_forti = run_suite("API Fortinet FortiGate (Puerto 8001)", "API Forti")
    code_omni = run_suite("API Alcatel OmniVista 2500 (Puerto 8000)", "API Omni")

    total_status = code_forti or code_omni
    print("#" * 60)
    if total_status == 0:
        print("[SUCCESS] RESUMEN: Todas las suites de prueba pasaron al 100%.")
    else:
        print("[WARNING] RESUMEN: Se detectaron fallos en una o más suites de prueba.")
    print("#" * 60 + "\n")

    sys.exit(total_status)


if __name__ == "__main__":
    main()
