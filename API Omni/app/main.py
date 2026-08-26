from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from scalar_fastapi import get_scalar_api_reference

from app.config import settings
from app.routers import (
    employees_router,
    company_properties_router,
    catalogs_router,
    monitoring_router,
    system_router,
)

# Inicialización de FastAPI: Únicamente Scalar (Swagger y ReDoc 100% deshabilitados)
app = FastAPI(
    title="OmniVista 2500 - Network Query & Monitoring API",
    description="""
    ## API REST Exclusiva de Consultas para Alcatel-Lucent OmniVista 2500 NMS.
    
    Esta API proporciona acceso de **solo lectura** para auditoría, monitoreo e inventario de red.
    
    ### Módulos de Consulta:
    1. **Cuentas y Empleados (`/api/v1/employees`)**: Directorio de usuarios y cuentas de acceso en OmniVista UPAM.
    2. **Dispositivos y MACs (`/api/v1/company-properties`)**: Direcciones MAC autorizadas y terminales en Company Property.
    3. **Monitoreo e Infraestructura (`/api/v1/monitoring`)**: Switches, Access Points, sesiones activas en vivo, topología y alarmas.
    4. **Catálogos y Redes (`/api/v1/catalogs`)**: Perfiles de red / SSIDs, opciones de equipos y catálogo de VLANs.
    5. **Sistema y Diagnóstico (`/api/v1/system`)**: Comprobación de salud, enlace con OmniVista y versión del NMS.
    
    *Documentación interactiva renderizada exclusivamente con **Scalar**.*
    """,
    version="2.0.0",
    docs_url=None,       # Swagger UI deshabilitado
    redoc_url=None,      # ReDoc deshabilitado
    openapi_url="/openapi.json",
)

# Configuración de CORS (solo métodos de consulta GET y preflight OPTIONS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

# Integración Exclusiva de Documentación Interactiva Scalar
@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title="OmniVista 2500 Query API - Scalar Reference",
        show_sidebar=True,
        default_open_all_tags=True,
        persist_auth=True,
        hide_models=False,
    )

@app.get("/scalar", include_in_schema=False)
async def scalar_docs_alias():
    return RedirectResponse(url="/docs")

@app.get("/swagger", include_in_schema=False)
async def swagger_redirect_to_scalar():
    """Redirige cualquier intento de acceso a /swagger directamente a Scalar (/docs)"""
    return RedirectResponse(url="/docs")

@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")


# Manejador de errores de validación de Pydantic
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        field = " -> ".join(str(loc) for loc in err.get("loc", []))
        errors.append(f"{field}: {err.get('msg')}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "message": "Parámetros de consulta no válidos.",
            "error": "; ".join(errors),
            "data": None
        },
    )


# Registrar Routers de Consulta
app.include_router(employees_router)
app.include_router(company_properties_router)
app.include_router(catalogs_router)
app.include_router(monitoring_router)
app.include_router(system_router)
