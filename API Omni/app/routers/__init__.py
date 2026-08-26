from app.routers.enrollment import router as enrollment_router
from app.routers.employees import router as employees_router
from app.routers.company_properties import router as company_properties_router
from app.routers.catalogs import router as catalogs_router
from app.routers.monitoring import router as monitoring_router
from app.routers.system import router as system_router

__all__ = [
    "enrollment_router",
    "employees_router",
    "company_properties_router",
    "catalogs_router",
    "monitoring_router",
    "system_router",
]
