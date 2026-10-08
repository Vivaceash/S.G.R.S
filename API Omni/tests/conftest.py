import sys
import pytest
from pathlib import Path

omni_dir = str(Path(__file__).resolve().parent.parent)
if omni_dir not in sys.path:
    sys.path.insert(0, omni_dir)

# Evitar colisión de módulos si otra suite importó un paquete 'app'
if "app" in sys.modules and not getattr(sys.modules["app"], "__file__", "").startswith(omni_dir):
    for mod in list(sys.modules.keys()):
        if mod == "app" or mod.startswith("app."):
            del sys.modules[mod]

from app.config import settings
from app.services.omnivista_service import omnivista_service
settings.ALLOWED_HOSTS = ["test", "testserver", "localhost", "127.0.0.1"]


@pytest.fixture(autouse=True)
def mock_omnivista_startup_login(monkeypatch):
    """Las pruebas de la API no deben depender de un OmniVista real."""
    monkeypatch.setattr(omnivista_service, "login", lambda: True)
    monkeypatch.setattr(
        omnivista_service,
        "health_check",
        lambda: {
            "status": "healthy",
            "omnivista_host": settings.ov_base_url,
            "omnivista_connected": True,
            "latency_ms": 0,
            "auth_mode": "CREDENTIALS",
            "message": "Prueba de OmniVista simulada",
        },
    )
