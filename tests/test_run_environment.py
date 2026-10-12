import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock

import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("root_run", ROOT_DIR / "run.py")
run_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_module)


def test_get_python_exe_returns_valid_python():
    py_exe = run_module.get_python_exe()
    assert py_exe is not None
    assert Path(py_exe).exists()
    assert ("python" in py_exe.lower()) or ("py" in py_exe.lower())


def test_windows_services_use_hidden_process_options(monkeypatch):
    monkeypatch.setattr(run_module.sys, "platform", "win32")

    class StartupInfo:
        def __init__(self):
            self.dwFlags = 0
            self.wShowWindow = None

    monkeypatch.setattr(run_module.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, raising=False)
    monkeypatch.setattr(run_module.subprocess, "CREATE_NO_WINDOW", 0x8000000, raising=False)
    monkeypatch.setattr(run_module.subprocess, "STARTUPINFO", StartupInfo, raising=False)
    monkeypatch.setattr(run_module.subprocess, "STARTF_USESHOWWINDOW", 1, raising=False)
    monkeypatch.setattr(run_module.subprocess, "SW_HIDE", 0, raising=False)

    options = run_module.windows_no_console_options()

    assert options["creationflags"] == 0x200 | 0x8000000
    assert options["startupinfo"].dwFlags == 1
    assert options["startupinfo"].wShowWindow == 0


def test_windows_install_creates_idempotent_cmd_launchers(tmp_path, monkeypatch):
    monkeypatch.setattr(run_module.sys, "platform", "win32")
    monkeypatch.setattr(run_module, "LAUNCHER_DIR", tmp_path)

    installed = run_module.install_launchers()
    assert {path.name for path in installed} == {"SGRS.cmd", "sgrs.cmd"}
    assert all("CREATE_NO_WINDOW" not in path.read_text() for path in installed)
    assert all("run.py" in path.read_text() for path in installed)

    second = run_module.install_launchers()
    assert second == installed


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
    monkeypatch.setattr(run_module, "local_network_ip", lambda: "192.0.2.10")

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


def test_api_environment_discovers_all_active_interfaces(monkeypatch):
    monkeypatch.setattr(run_module, "lan_ipv4_addresses", lambda: ["15.40.2.15", "100.124.6.37"])
    env = {
        "SGRS_SERVER_IP": "192.168.38.250",
        "SGRS_LAN_ORIGIN": "http://192.168.38.250:3000",
    }

    result = run_module.api_environment(env, 3000, "omni")

    assert result["SERVER_HOST"] == "0.0.0.0"
    assert set(result["ALLOWED_HOSTS"].split(",")) >= {"192.168.38.250", "15.40.2.15", "100.124.6.37"}
    origins = set(result["CORS_ORIGINS"].split(","))
    assert {"http://15.40.2.15:3000", "http://100.124.6.37:3000"} <= origins

    inventory = run_module.api_environment(env, 3000, "inventarios")
    assert inventory["INVENTARIOS_HOST"] == "0.0.0.0"
    assert "15.40.2.15" in inventory["INVENTARIOS_ALLOWED_HOSTS"]


def test_is_pid_alive():
    assert run_module.is_pid_alive(os.getpid()) is True
    assert run_module.is_pid_alive(9999999) is False
    assert run_module.is_pid_alive(0) is False
    assert run_module.is_pid_alive(-1) is False
    assert run_module.is_pid_alive(None) is False


def test_dashboard_port_stays_fixed_for_permanent_qrs(monkeypatch):
    monkeypatch.setenv("DASHBOARD_PORT", "3001")
    monkeypatch.setenv("PORT", "3002")
    monkeypatch.setattr(run_module, "load_pids", lambda: {"dashboard": os.getpid(), "dashboard_port": 3001})
    assert run_module.get_dashboard_port() == 3000
    assert run_module.get_dashboard_port(preferred_port=3002) == 3000


def test_permanent_qr_origin_and_port_are_constants():
    assert run_module.PERMANENT_QR_ORIGIN == "http://192.168.38.250:3000"
    assert run_module.PERMANENT_QR_PORT == 3000
    assert run_module.get_dashboard_port(preferred_port=3001) == 3000


def test_service_specs_include_four_components_and_inventory_override(monkeypatch):
    monkeypatch.setenv("INVENTARIOS_PORT", "8012")
    services = run_module.service_specs(3002)
    assert [service["key"] for service in services] == [
        "api_omni", "api_forti", "api_inventarios", "dashboard",
    ]
    assert [service["port"] for service in services] == [8000, 8001, 8012, 3002]


def test_wait_for_services_requires_all_four_readiness_checks(monkeypatch):
    services = run_module.service_specs(3000)
    processes = {service["key"]: Mock(poll=Mock(return_value=None)) for service in services}
    attempts = {service["key"]: 0 for service in services}

    def readiness(service):
        key = service["key"]
        attempts[key] += 1
        return attempts[key] >= (2 if key == "api_omni" else 1)

    monkeypatch.setattr(run_module, "service_ready", readiness)
    monkeypatch.setattr(run_module.time, "sleep", lambda delay: None)
    run_module.wait_for_services(services, processes)
    assert attempts == {"api_omni": 2, "api_forti": 1, "api_inventarios": 1, "dashboard": 1}


def test_wait_for_services_rejects_provider_startup_failure(monkeypatch):
    services = run_module.service_specs(3000)
    processes = {service["key"]: Mock(poll=Mock(return_value=None)) for service in services}
    processes["api_omni"].poll.return_value = 3
    monkeypatch.setattr(run_module, "service_ready", lambda service: True)
    with pytest.raises(RuntimeError, match="OmniVista falló al arrancar"):
        run_module.wait_for_services(services, processes)


def test_wait_for_services_times_out_without_claiming_success(monkeypatch):
    service = run_module.service_specs(3000)[0]
    process = Mock(poll=Mock(return_value=None))
    monkeypatch.setattr(run_module, "service_ready", lambda spec: False)
    with pytest.raises(RuntimeError, match="No quedaron listos"):
        run_module.wait_for_services([service], {service["key"]: process}, timeout=0)


def test_detached_start_launches_and_verifies_all_four_services(tmp_path, monkeypatch):
    (tmp_path / "server.py").write_text("# Fixture del dashboard\n")
    monkeypatch.setattr(run_module, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(run_module, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(run_module, "MAIN_LOG", tmp_path / "logs/sgrs.log")
    monkeypatch.setattr(run_module, "PID_FILE", tmp_path / "pids.json")
    monkeypatch.setattr(run_module, "ensure_environment", lambda: None)
    monkeypatch.setattr(run_module, "ensure_inventory_config", lambda py: None)
    monkeypatch.setattr(run_module, "get_dashboard_port", lambda: 3000)
    monkeypatch.setattr(run_module, "is_port_in_use", lambda port: False)
    monkeypatch.setattr(run_module, "service_ready", lambda service: False)
    monkeypatch.setattr(run_module, "get_env", lambda py: {})
    monkeypatch.setenv("INVENTARIOS_PORT", "8002")
    monkeypatch.setattr(run_module, "dashboard_environment", lambda env, port: {**env, "DASHBOARD_PORT": str(port)})
    processes = [Mock(pid=pid) for pid in (401, 402, 403, 404)]
    popen = Mock(side_effect=processes)
    monkeypatch.setattr(run_module.subprocess, "Popen", popen)
    verify = Mock()
    monkeypatch.setattr(run_module, "wait_for_services", verify)

    run_module.start_services(detached=True)

    calls = popen.call_args_list
    assert [Path(call.kwargs["cwd"]).name for call in calls] == ["API Forti", "API Omni", "API Inventarios", tmp_path.name]
    assert calls[2].kwargs["env"]["INVENTARIOS_PORT"] == "8002"
    assert calls[3].kwargs["env"]["DASHBOARD_PORT"] == "3000"
    verify.assert_called_once()
    assert set(verify.call_args.args[1]) == {"api_omni", "api_forti", "api_inventarios", "dashboard"}
    assert run_module.load_pids()["api_inventarios"] == 403


def test_start_recovers_failed_omni_while_other_registered_services_keep_running(tmp_path, monkeypatch):
    (tmp_path / "server.py").write_text("# Fixture\n")
    monkeypatch.setattr(run_module, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(run_module, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(run_module, "MAIN_LOG", tmp_path / "logs/sgrs.log")
    monkeypatch.setattr(run_module, "PID_FILE", tmp_path / "pids.json")
    registry = {"api_forti": 401, "api_omni": 402, "api_inventarios": 403,
                "dashboard": 404, "dashboard_port": 3000}
    run_module.save_pids(registry)
    monkeypatch.setattr(run_module, "ensure_environment", lambda: None)
    monkeypatch.setattr(run_module, "ensure_inventory_config", lambda py: None)
    monkeypatch.setattr(run_module, "get_dashboard_port", lambda: 3000)
    monkeypatch.setattr(run_module, "is_port_in_use", lambda port: port in (8001, 8002, 3000))
    monkeypatch.setattr(run_module, "is_pid_alive", lambda pid: pid in (401, 403, 404))
    monkeypatch.setattr(run_module, "service_ready", lambda service: service["key"] != "api_omni")
    monkeypatch.setattr(run_module, "validate_registered_process", lambda service, pid: None, raising=False)
    monkeypatch.setattr(run_module, "process_matches_service", lambda service, pid: True)
    monkeypatch.setattr(run_module, "get_env", lambda py: {})
    monkeypatch.setenv("INVENTARIOS_PORT", "8002")
    monkeypatch.setattr(run_module, "dashboard_environment", lambda env, port: {**env, "DASHBOARD_PORT": str(port)})
    popen = Mock(return_value=Mock(pid=405))
    monkeypatch.setattr(run_module.subprocess, "Popen", popen)
    verify = Mock()
    monkeypatch.setattr(run_module, "wait_for_services", verify)

    run_module.start_services(detached=True)

    popen.assert_called_once()
    assert Path(popen.call_args.kwargs["cwd"]).name == "API Omni"
    assert run_module.load_pids() == {**registry, "api_omni": 405}
    verify.assert_called_once()


def test_start_refuses_unregistered_inventory_listener_before_launching(tmp_path, monkeypatch):
    monkeypatch.setattr(run_module, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(run_module, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(run_module, "ensure_environment", lambda: None)
    monkeypatch.setattr(run_module, "ensure_inventory_config", lambda py: None)
    monkeypatch.setattr(run_module, "get_dashboard_port", lambda: 3000)
    monkeypatch.setattr(run_module, "is_port_in_use", lambda port: port == 8002)
    monkeypatch.setattr(run_module, "service_ready", lambda service: False)
    monkeypatch.setattr(run_module, "load_pids", lambda: {})
    monkeypatch.setenv("INVENTARIOS_PORT", "8002")
    popen = Mock()
    monkeypatch.setattr(run_module.subprocess, "Popen", popen)
    with pytest.raises(RuntimeError, match="API Inventarios.*proceso no registrado"):
        run_module.start_services(detached=True)
    popen.assert_not_called()


def test_startup_error_uses_only_current_launch_and_safe_diagnostic(tmp_path, monkeypatch):
    log = tmp_path / "sgrs.log"
    log.write_text(
        "[SGRS] Inicio de sesión en segundo plano: earlier\n"
        "[OV-AUTH] OmniVista rechazó el login (HTTP 401).\n"
        "[SGRS] Inicio de sesión en segundo plano: current\n"
        "[OV-AUTH] OmniVista rechazó el login (HTTP 403).\n"
    )
    monkeypatch.setattr(run_module, "MAIN_LOG", log)
    service = run_module.service_specs(3000)[0]
    assert run_module.provider_startup_error(service) == " OmniVista rechazó el login (HTTP 403)."
    log.write_text("[SGRS] Inicio de sesión en segundo plano: current\n[OV-AUTH] unexpected-sensitive-data\n")
    assert run_module.provider_startup_error(service) == ""


def test_api_readiness_requires_healthy_json(monkeypatch):
    response = MagicMock(status=200)
    response.__enter__.return_value = response
    response.read.return_value = b'{"status":"unhealthy"}'
    opener = Mock()
    opener.open.return_value = response
    monkeypatch.setattr(run_module, "build_opener", lambda *args: opener)
    service = run_module.service_specs(3000)[0]
    assert run_module.service_ready(service) is False
    response.read.return_value = b'{"status":"healthy"}'
    assert run_module.service_ready(service) is True


def test_dashboard_readiness_checks_sgrs_page_content(monkeypatch):
    response = MagicMock(status=200)
    response.__enter__.return_value = response
    response.read.return_value = b'<html><title>Centro Operativo SGRS</title><div id="root"></div></html>'
    opener = Mock()
    opener.open.return_value = response
    monkeypatch.setattr(run_module, "build_opener", lambda *args: opener)
    service = run_module.service_specs(3000)[-1]

    assert run_module.service_ready(service) is True
    response.read.return_value = b"<html>another app</html>"
    assert run_module.service_ready(service) is False


def test_status_reports_four_services_and_network_blocker(monkeypatch, capsys):
    monkeypatch.setattr(run_module, "load_pids", lambda: {"dashboard_port": 3002})
    monkeypatch.setattr(run_module, "service_ready", Mock(side_effect=PermissionError("network blocked")))
    run_module.status_services()
    output = capsys.readouterr().out
    assert output.count("NO COMPROBABLE: SIN PERMISO DE RED") == 4
    assert "API Inventarios" in output
    assert "Dashboard React (3002)" in output
    assert "LISTO" not in output


def test_restart_does_not_stop_services_when_network_checks_are_blocked(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["run.py", "restart"])
    stop = Mock()
    monkeypatch.setattr(run_module, "stop_services", stop)
    monkeypatch.setattr(run_module, "is_port_in_use", Mock(side_effect=PermissionError("network blocked")))
    with pytest.raises(PermissionError):
        run_module.main()
    stop.assert_not_called()


def test_stop_skips_reused_pid_without_signaling_and_cleans_registry(tmp_path, monkeypatch):
    if sys.platform != "linux":
        pytest.skip("La identidad del proceso se comprueba con /proc en Linux")
    registry = tmp_path / "pids.json"
    registry.write_text('{"api_omni": 123}')
    monkeypatch.setattr(run_module, "PID_FILE", registry)
    # El propio pytest es un proceso vivo, pero no el run.py de API Omni.
    monkeypatch.setattr(run_module, "load_pids", lambda: {"api_omni": os.getpid()})
    monkeypatch.setattr(run_module, "is_pid_alive", lambda pid: True)
    kill = Mock()
    killpg = Mock()
    monkeypatch.setattr(run_module.os, "kill", kill)
    monkeypatch.setattr(run_module.os, "killpg", killpg)
    run_module.stop_services()
    kill.assert_not_called()
    killpg.assert_not_called()
    assert not registry.exists()


def test_stop_includes_inventory_and_waits_before_erasing_registry(tmp_path, monkeypatch):
    registry = tmp_path / "pids.json"
    registry.write_text('{"api_inventarios": 123}')
    monkeypatch.setattr(run_module, "PID_FILE", registry)
    monkeypatch.setattr(run_module, "load_pids", lambda: {"api_inventarios": 123})
    # Elegir la rama Windows evita leer un PID real y permite simular taskkill.
    monkeypatch.setattr(run_module.sys, "platform", "win32")
    monkeypatch.setattr(run_module, "is_pid_alive", Mock(side_effect=[True, True, False]))
    monkeypatch.setattr(run_module.time, "sleep", lambda delay: None)
    taskkill = Mock()
    monkeypatch.setattr(run_module.subprocess, "run", taskkill)
    run_module.stop_services()
    assert taskkill.call_args.args[0] == ["taskkill", "/T", "/PID", "123"]
    assert not registry.exists()


def test_unknown_command_cannot_start_platform(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["run.py", "restar"])
    start = Mock()
    monkeypatch.setattr(run_module, "start_services", start)
    with pytest.raises(RuntimeError, match="Comando desconocido"):
        run_module.main()
    start.assert_not_called()


def test_open_uses_dashboard_registered_port(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["run.py", "open"])
    monkeypatch.setattr(run_module, "load_pids", lambda: {"dashboard_port": 3002})
    opened = Mock()
    monkeypatch.setattr(run_module.webbrowser, "open", opened)
    run_module.main()
    opened.assert_called_once_with("http://localhost:3002")


@pytest.mark.skipif(sys.platform != "linux", reason="El launcher SGRS usa Bash en Linux")
def test_sgrs_launcher_resolves_symlink_from_another_directory(tmp_path):
    launcher = tmp_path / "SGRS"
    launcher.symlink_to(ROOT_DIR / "sgrs.sh")
    result = subprocess.run([str(launcher), "help"], cwd=tmp_path, text=True,
                            capture_output=True, timeout=10)
    assert result.returncode == 0
    assert "Inventarios" in result.stdout
    assert "Dashboard" in result.stdout
