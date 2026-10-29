"""Exercise first installation without copying credentials or existing environments.

Run with the supported host Python: python tests/check_clean_setup.py
The temporary path intentionally contains spaces, as common Windows paths do.
"""
import hashlib
import os
from pathlib import Path
import shutil
import secrets
import socket
import subprocess
import sys
import tempfile


def main():
    source = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="SGRS clean setup ") as temporary:
        root = Path(temporary)
        for path in source.glob("*.py"):
            shutil.copy2(path, root / path.name)
        for name in ("requirements.lock", "requirements.txt", ".nvmrc", ".python-version", "sgrs.sh"):
            shutil.copy2(source / name, root / name)
        ignored = shutil.ignore_patterns(".env", ".env.*", ".private", ".venv", "venv", "node_modules", "dist", "__pycache__", "*.sqlite3", "logs", "artifacts", ".pytest_cache")
        for name in ("Dashboard", "API Inventarios", "API Forti", "API Omni", "tests"):
            shutil.copytree(source / name, root / name, ignore=ignored)
        env = {key: value for key, value in os.environ.items() if not key.startswith(("SGRS_", "OV_", "FORTIOS_", "INVENTARIOS_"))}
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONPATH", None)
        env.pop("PYTHONHOME", None)
        env["PYTHONIOENCODING"] = "utf-8"
        print("Checking clean installation in a path containing spaces...", flush=True)
        subprocess.run([sys.executable, str(root / "run.py"), "setup"], cwd=root.parent, env=env, check=True)
        python = root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        assert python.is_file(), "Setup did not create the local interpreter"
        files = [root / ".venv/.sgrs-requirements.sha256", root / "Dashboard/dist/.sgrs-build.sha256", root / "API Inventarios/.private/.env"]
        before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in files]
        result = subprocess.run([sys.executable, str(root / "run.py"), "setup"], cwd=root.parent, env=env, check=True, capture_output=True, text=True, encoding="utf-8")
        assert "Preparando Dashboard" not in result.stdout, "Unchanged frontend was rebuilt"
        assert "Instalando requirements.lock" not in result.stdout, "Unchanged dependencies were reinstalled"
        assert before == [hashlib.sha256(path.read_bytes()).hexdigest() for path in files], "Repeated setup changed keys or build stamps"
        subprocess.run([str(python), "-m", "pip", "check"], cwd=root, env=env, check=True)
        subprocess.run([str(python), "-m", "pytest", "tests/test_run_environment.py", "-q"], cwd=root, env=env, check=True)
        if "--services" in sys.argv:
            # CI-only smoke: disposable credentials and loopback providers, never institutional equipment.
            ports = [8000, 8001, 8002, 3000]
            for port in ports:
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1", port))
            env.update({"SGRS_INITIAL_USER_PASSWORD": secrets.token_urlsafe(32),
                        "OV_HOST": "127.0.0.1", "OV_PORT": "9", "OV_USERNAME": "", "OV_PASSWORD": "",
                        "FORTIOS_HOST": "127.0.0.1", "FORTIOS_PORT": "9", "FORTIOS_API_TOKEN": "",
                        "REQUIRE_PROVIDER_ON_STARTUP": "false", "DEBUG": "false"})
            command = [str(python), str(root / "run.py")]
            try:
                subprocess.run([*command, "start"], cwd=root.parent, env=env, check=True)
                status = subprocess.run([*command, "status"], cwd=root.parent, env=env, check=True, capture_output=True, text=True, encoding="utf-8")
                print(status.stdout)
                assert status.stdout.count('[LISTO]') == 4, "Not all four local services passed HTTP readiness"
            finally:
                subprocess.run([*command, "stop"], cwd=root.parent, env=env, check=True)
            print("PASS: all four local services started, passed HTTP readiness and stopped.", flush=True)
        print("PASS: fresh venv, hashed Python dependencies, locked frontend build, repeat setup, preserved keys and runner tests.", flush=True)


if __name__ == "__main__":
    main()
