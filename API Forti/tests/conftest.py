import sys
import pytest
from pathlib import Path

forti_dir = str(Path(__file__).resolve().parent.parent)
if forti_dir not in sys.path:
    sys.path.insert(0, forti_dir)

# Evitar colisión de módulos si otra suite importó un paquete 'app'
if "app" in sys.modules and not getattr(sys.modules["app"], "__file__", "").startswith(forti_dir):
    for mod in list(sys.modules.keys()):
        if mod == "app" or mod.startswith("app."):
            del sys.modules[mod]

from app.core.config import settings
from app.clients.fortios import fortios_client
settings.ALLOWED_HOSTS = ["test", "localhost", "127.0.0.1"]


@pytest.fixture(autouse=True)
def mock_fortigate_startup(monkeypatch):
    """Las pruebas no deben depender del certificado ni de un FortiGate real."""
    monkeypatch.setattr(fortios_client, "get_system_status", lambda **kwargs: _status())


async def _status():
    return {"status": "success", "results": {}}
