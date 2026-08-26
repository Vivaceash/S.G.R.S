from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from scalar_fastapi import get_scalar_api_reference

from app.config import settings
from app.routers import (
    enrollment_router,
    employees_router,
    company_properties_router,
    catalogs_router,
    monitoring_router,
    system_router,
)

# Inicialización de FastAPI
app = FastAPI(
    title="OmniVista 2500 - Network Access & Employee Management API",
    description="""
    ## API REST para Gestión de Acceso a Red y Altas de Empleados en Alcatel-Lucent OmniVista 2500 NMS.
    
    Esta API sirve como backend para el dashboard externo en React + Vite.
    
    ### Flujos Principales:
    1. **Alta Unificada (`/api/v1/enrollment/complete-user`)**: Registro de cuenta de empleado y asociación de dirección MAC en una sola petición.
    2. **Cuentas de Empleados (`/api/v1/employees`)**: CRUD para Employee Accounts en OmniVista UPAM.
    3. **Dispositivos y MACs (`/api/v1/company-properties`)**: CRUD para direcciones MAC en Company Property.
    4. **Catálogos (`/api/v1/catalogs`)**: Lista de redes/SSIDs y categorías de dispositivos.
    5. **Monitoreo (`/api/v1/monitoring`)**: Dispositivos conectados e infraestructura de switches y APs.
    """,
    version="1.0.0",
    docs_url=None,       # Deshabilitar Swagger por defecto para usar Scalar
    redoc_url=None,      # Deshabilitar ReDoc
    openapi_url="/openapi.json",
)

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Integración de Documentación Interactiva Scalar
@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title="OmniVista 2500 API Reference",
        hide_models=False,
    )

@app.get("/scalar", include_in_schema=False)
async def scalar_docs_alias():
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
            "message": "Error de validación en los datos enviados.",
            "error": "; ".join(errors),
            "data": None
        },
    )


# Registrar Routers
app.include_router(enrollment_router)
app.include_router(employees_router)
app.include_router(company_properties_router)
app.include_router(catalogs_router)
app.include_router(monitoring_router)
app.include_router(system_router)
