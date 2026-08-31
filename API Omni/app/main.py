from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from scalar_fastapi import get_scalar_api_reference

from app.config import settings
from app.errors import OmniVistaBaseException
from app.middleware import (
    SecurityHeadersMiddleware,
    RateLimitingMiddleware,
    RequestContextMiddleware,
    RequestSizeLimitMiddleware,
)
from app.security import security_logger
from app.routers import (
    employees_router,
    company_properties_router,
    catalogs_router,
    monitoring_router,
    system_router,
    auth_router,
)

# Inicialización de FastAPI: Scalar condicionado por ENABLE_DOCS
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
    version="2.1.0",
    docs_url=None,       # Swagger UI deshabilitado
    redoc_url=None,      # ReDoc deshabilitado
    openapi_url="/openapi.json" if settings.ENABLE_DOCS else None,
)

# Configuración de CORS segura
cors_origins = settings.CORS_ORIGINS if settings.CORS_ORIGINS else ["http://localhost:5173"]

# Pila de Middlewares (Se añaden en orden inverso a su ejecución externa)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"],
    expose_headers=["X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
)
app.add_middleware(
    RateLimitingMiddleware,
    rate_limit_per_minute=settings.RATE_LIMIT_PER_MINUTE,
    auth_rate_limit_per_minute=settings.AUTH_RATE_LIMIT_PER_MINUTE,
)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_bytes=settings.MAX_REQUEST_BODY_BYTES
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)
if settings.ALLOWED_HOSTS and "*" not in settings.ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)


# -------------------------------------------------------------
# Endpoint Público Ligero de Ping / Liveness Probe
# -------------------------------------------------------------
@app.get("/health", tags=["Salud y Conectividad"], include_in_schema=False)
async def ping():
    """Liveness probe público para balanceadores y contenedores sin exponer datos de red."""
    return {
        "status": "healthy",
        "app": "OmniVista 2500 - Network Query & Monitoring API",
        "version": "2.1.0",
        "environment": settings.ENVIRONMENT,
    }


# Integración de Documentación Interactiva Scalar (condicionada por configuración)
@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    if not settings.ENABLE_DOCS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La documentación interactiva ha sido deshabilitada por configuración de seguridad."
        )
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


# Manejador de excepciones especializadas de OmniVista
@app.exception_handler(OmniVistaBaseException)
async def omnivista_exception_handler(request: Request, exc: OmniVistaBaseException):
    req_id = getattr(request.state, "request_id", "N/A")
    security_logger.warning(f"[{req_id}] Excepción OmniVista interceptada [{exc.status_code}]: {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "message": exc.message,
            "error": exc.message,
            "data": exc.details if settings.DEBUG else None,
        },
        headers={"X-Request-ID": req_id}
    )


# Manejador de errores de validación de Pydantic
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    req_id = getattr(request.state, "request_id", "N/A")
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
        headers={"X-Request-ID": req_id}
    )


# Manejador global para excepciones internas no controladas (HTTP 500)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", "N/A")
    security_logger.error(
        f"Internal Error | req_id={req_id} | path={request.url.path} | exc={repr(exc)}",
        exc_info=settings.DEBUG
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "message": "Error interno del servidor al procesar la solicitud.",
            "error": f"Ocurrió un error inesperado. Ref: {req_id}",
            "data": None
        },
        headers={"X-Request-ID": req_id}
    )


# Registrar Routers de Consulta y Autenticación
app.include_router(employees_router)
app.include_router(company_properties_router)
app.include_router(catalogs_router)
app.include_router(monitoring_router)
app.include_router(system_router)
app.include_router(auth_router)

