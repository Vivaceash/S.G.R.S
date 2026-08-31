from app.routers.health import router as health_router
from app.routers.system import router as system_router
from app.routers.devices import router as devices_router
from app.routers.traffic import router as traffic_router
from app.routers.network import router as network_router
from app.routers.firewall import router as firewall_router
from app.routers.vpn import router as vpn_router
from app.routers.auth import router as auth_router

__all__ = [
    "health_router",
    "system_router",
    "devices_router",
    "traffic_router",
    "network_router",
    "firewall_router",
    "vpn_router",
    "auth_router",
]
