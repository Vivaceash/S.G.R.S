import sys
from pathlib import Path

forti_dir = str(Path(__file__).resolve().parent.parent)
if forti_dir not in sys.path:
    sys.path.insert(0, forti_dir)

# Evitar colisión de módulos si otra suite importó un paquete 'app'
if "app" in sys.modules and not getattr(sys.modules["app"], "__file__", "").startswith(forti_dir):
    for mod in list(sys.modules.keys()):
        if mod == "app" or mod.startswith("app."):
            del sys.modules[mod]
