import importlib.util
import os
import stat
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("root_run", ROOT_DIR / "run.py")
run_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_module)


def test_get_python_exe_returns_valid_python():
    py_exe = run_module.get_python_exe()
    assert py_exe is not None
    assert Path(py_exe).exists()
    assert ("python" in py_exe.lower()) or ("py" in py_exe.lower())


def test_ensure_environment_sets_permissions_on_private_dir(tmp_path, monkeypatch):
    test_private = tmp_path / ".sgrs-private"
    test_private.mkdir(parents=True)
    test_db = test_private / "dashboard.sqlite3"
    test_db.write_text("sqlite test content")

    monkeypatch.setattr(run_module, "ROOT_DIR", tmp_path)

    # Solo comprobar permisos POSIX en sistemas no Windows
    if sys.platform != "win32":
        run_module.ensure_environment()
        dir_mode = stat.S_IMODE(os.stat(test_private).st_mode)
        file_mode = stat.S_IMODE(os.stat(test_db).st_mode)
        assert dir_mode == 0o700
        assert file_mode == 0o600


def test_main_handles_setup_command(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["run.py", "setup"])
    setup_called = False

    def mock_ensure():
        nonlocal setup_called
        setup_called = True

    monkeypatch.setattr(run_module, "ensure_environment", mock_ensure)
    run_module.main()

    assert setup_called is True
    captured = capsys.readouterr()
    assert "Configuración y Preparación del Entorno" in captured.out
    assert "El entorno está listo" in captured.out


def test_load_env_fallback(tmp_path, monkeypatch):
    test_env = tmp_path / ".env"
    test_env.write_text(
        "# Comment line\n"
        "TEST_FALLBACK_KEY1=val1\n"
        "export TEST_FALLBACK_KEY2=\"val2 with spaces\"\n"
        "TEST_FALLBACK_KEY3='val3'\n"
        "INVALID_LINE\n"
    )
    monkeypatch.delenv("TEST_FALLBACK_KEY1", raising=False)
    monkeypatch.delenv("TEST_FALLBACK_KEY2", raising=False)
    monkeypatch.delenv("TEST_FALLBACK_KEY3", raising=False)

    run_module.load_env_fallback(test_env)

    assert os.environ.get("TEST_FALLBACK_KEY1") == "val1"
    assert os.environ.get("TEST_FALLBACK_KEY2") == "val2 with spaces"
    assert os.environ.get("TEST_FALLBACK_KEY3") == "val3"


def test_dashboard_environment_host_and_lan_rules(monkeypatch):
    monkeypatch.delenv("DASHBOARD_HOST", raising=False)
    monkeypatch.delenv("SGRS_LAN_ORIGIN", raising=False)

    # 1. Sin host ni LAN origin: DASHBOARD_HOST=127.0.0.1 y LAN fallback al host IP
    res1 = run_module.dashboard_environment({}, 3000)
    assert res1["DASHBOARD_HOST"] == "127.0.0.1"
    assert res1["PORT"] == "3000"
    assert res1["DASHBOARD_PORT"] == "3000"
    assert res1["SGRS_LAN_ORIGIN"].startswith("http://")

    # 2. Sin host pero con LAN origin: DASHBOARD_HOST="0.0.0.0", origen LAN no se sobrescribe
    res2 = run_module.dashboard_environment({"SGRS_LAN_ORIGIN": "http://192.168.38.250:3000"}, 3000)
    assert res2["DASHBOARD_HOST"] == "0.0.0.0"
    assert res2["SGRS_LAN_ORIGIN"] == "http://192.168.38.250:3000"

    # 3. Con host explícito: respeta el host configurado aunque exista LAN origin
    res3 = run_module.dashboard_environment({"DASHBOARD_HOST": "127.0.0.1", "SGRS_LAN_ORIGIN": "http://192.168.38.250:3000"}, 3000)
    assert res3["DASHBOARD_HOST"] == "127.0.0.1"
    assert res3["SGRS_LAN_ORIGIN"] == "http://192.168.38.250:3000"

    # 4. Origen en os.environ (.env): no se sobrescribe y DASHBOARD_HOST usa 0.0.0.0 por defecto
    monkeypatch.setenv("SGRS_LAN_ORIGIN", "http://192.168.38.250:3000,http://192.168.38.250")
    res4 = run_module.dashboard_environment({}, 3000)
    assert res4["DASHBOARD_HOST"] == "0.0.0.0"
    assert res4["SGRS_LAN_ORIGIN"] == "http://192.168.38.250:3000,http://192.168.38.250"


def test_is_pid_alive():
    assert run_module.is_pid_alive(os.getpid()) is True
    assert run_module.is_pid_alive(9999999) is False
    assert run_module.is_pid_alive(0) is False
    assert run_module.is_pid_alive(-1) is False
    assert run_module.is_pid_alive(None) is False


def test_get_dashboard_port_verifies_process_liveness(monkeypatch):
    monkeypatch.delenv("DASHBOARD_PORT", raising=False)
    monkeypatch.delenv("PORT", raising=False)

    # 1. PID guardado vivo: reutiliza el puerto guardado (3001)
    monkeypatch.setattr(run_module, "load_pids", lambda: {"dashboard": os.getpid(), "dashboard_port": 3001})
    port = run_module.get_dashboard_port()
    assert port == 3001

    # 2. PID guardado muerto: no reutiliza 3001 y evalúa el puerto preferido (3000)
    monkeypatch.setattr(run_module, "load_pids", lambda: {"dashboard": 9999999, "dashboard_port": 3001})
    port_evaluated = run_module.get_dashboard_port()
    # Si 3000 está libre en la máquina de pruebas, devuelve 3000
    assert port_evaluated in (3000, 3001)

