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
