from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from scalar_fastapi import get_scalar_api_reference
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.errors import FortiOSBaseException
from app.core.security import limiter
from app.clients.fortios import fortios_client
from app.routers import (
    health_router,
    system_router,
    devices_router,
    traffic_router,
    network_router,
    firewall_router,
    vpn_router,
)

# Configuración de Logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fortinet_api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manejo del ciclo de vida de la aplicación."""
    logger.info(f"🚀 Iniciando {settings.APP_NAME} v{settings.APP_VERSION} en el puerto {settings.PORT}")
    logger.info(f"🔗 FortiGate Host objetivo: {settings.fortios_base_url} (VDOM: {settings.FORTIOS_DEFAULT_VDOM})")
    yield
    logger.info("🛑 Apagando aplicación y cerrando pools de conexión HTTPX...")
    await fortios_client.close()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    ## API de Integración y Monitoreo para Fortinet FortiGate (FortiOS)
    
    Esta API proporciona endpoints de lectura y visibilidad en tiempo real sobre:
    - **Dispositivos Conectados**: Inventario en red, dirección MAC, fabricante de hardware, sistema operativo, IP y estado online.
    - **Tráfico y Sitios Visitados**: Sesiones activas de firewall/NAT, top de destinos más consultados y logs de navegación web.
    - **Salud del Sistema**: Consumo de CPU, Memoria RAM, estado del cluster HA y versiones de firmware.
    - **Red y DHCP**: Concesiones de IP dinámicas, tablas ARP e interfaces de red.
    - **Políticas y Seguridad**: Reglas de firewall, objetos de dirección y grupos.
    - **VPN**: Estado de túneles IPsec y usuarios conectados vía SSL-VPN.
    
    ### Seguridad
    Para consumir estos endpoints se requiere enviar la cabecera `X-API-Key` con la clave configurada en el servidor.
    """,
    docs_url=None,       # Usaremos Scalar como visor principal de documentación
    redoc_url=None,
    lifespan=lifespan,
)

# Integrar Rate Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# -------------------------------------------------------------
# Middleware de Seguridad y Cabeceras HTTP
# -------------------------------------------------------------
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# -------------------------------------------------------------
# CORS
# -------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Modificar con orígenes específicos en producción
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# -------------------------------------------------------------
# Manejadores Globales de Excepciones
# -------------------------------------------------------------
@app.exception_handler(FortiOSBaseException)
async def fortios_exception_handler(request: Request, exc: FortiOSBaseException):
    logger.warning(f"Excepción FortiOS interceptada [{exc.status_code}]: {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.__class__.__name__,
            "message": exc.message,
            "details": exc.details if settings.DEBUG else None,
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Error no controlado en {request.url.path}: {exc}", exc_info=settings.DEBUG)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "InternalServerError",
            "message": "Ha ocurrido un error interno en el servidor.",
            "details": str(exc) if settings.DEBUG else None,
        },
    )


# -------------------------------------------------------------
# Documentación Interactiva Scalar
# -------------------------------------------------------------
@app.get("/scalar", include_in_schema=False)
async def scalar_html():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title=f"{settings.APP_NAME} - Scalar Docs",
        servers=[{"url": f"http://localhost:{settings.PORT}", "description": "Servidor Local (Puerto 8001)"}],
    )


@app.get("/docs", include_in_schema=False)
async def docs_redirect():
    """Redirigir /docs directamente a Scalar."""
    return RedirectResponse(url="/scalar")


@app.get("/", include_in_schema=False)
async def root():
    """Ruta raíz con redirección a la documentación interactiva."""
    return RedirectResponse(url="/scalar")


# -------------------------------------------------------------
# Registro de Routers bajo prefijo /api/v1
# -------------------------------------------------------------
api_v1_prefix = "/api/v1"
app.include_router(health_router, prefix=api_v1_prefix)
app.include_router(system_router, prefix=api_v1_prefix)
app.include_router(devices_router, prefix=api_v1_prefix)
app.include_router(traffic_router, prefix=api_v1_prefix)
app.include_router(network_router, prefix=api_v1_prefix)
app.include_router(firewall_router, prefix=api_v1_prefix)
app.include_router(vpn_router, prefix=api_v1_prefix)
