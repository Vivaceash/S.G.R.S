import asyncio
from contextlib import asynccontextmanager
import logging
import time
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from scalar_fastapi import get_scalar_api_reference
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.errors import FortiOSBaseException
from app.core.security import limiter
from app.clients.fortios import fortios_client
from app.middleware import (
    SecurityHeadersMiddleware,
    RateLimitingMiddleware,
    RequestContextMiddleware,
    RequestSizeLimitMiddleware,
)
from app.security.logging import log_security_event, mask_sensitive_ip
from app.routers import (
    health_router,
    system_router,
    devices_router,
    traffic_router,
    network_router,
    firewall_router,
    vpn_router,
    auth_router,
)

# Configuración de Logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fortinet_api")


async def _fortios_telemetry_keepalive():
    """
    Tarea en segundo plano que mantiene sincronizado y activo el motor de detección de dispositivos
    (CID) de FortiOS consultando periódicamente el endpoint unificado y la tabla ARP.
    Evita que el firewall degrade la telemetría tras periodos prolongados de inactividad.
    """
    logger.info("🔄 Iniciando sincronizador continuo de telemetría FortiOS en segundo plano...")
    while True:
        try:
            await asyncio.sleep(60)
            now_ts = int(time.time())
            await asyncio.gather(
                fortios_client.get_connected_devices(params={
                    "query_type": "unified_latest",
                    "count": 5000,
                    "timestamp_from": now_ts - 3600,
                    "timestamp_to": now_ts + 60,
                }),
                fortios_client.get_arp_table(),
                return_exceptions=True,
            )
            logger.debug("✅ Telemetría FortiOS (unified_latest + ARP) sincronizada en segundo plano.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Aviso en sincronización en segundo plano de FortiOS: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manejo del ciclo de vida de la aplicación."""
    masked_target = mask_sensitive_ip(settings.fortios_base_url) if settings.MASK_INTERNAL_IPS else settings.fortios_base_url
    logger.info(f"🚀 Iniciando {settings.APP_NAME} v{settings.APP_VERSION} en el puerto {settings.PORT} ({settings.ENVIRONMENT})")
    logger.info(f"🔗 FortiGate Host objetivo: {masked_target} (VDOM: {settings.FORTIOS_DEFAULT_VDOM})")
    logger.info(f"🛡️  Claves de API configuradas: {len(settings.api_keys)} activa(s)")

    if settings.ENVIRONMENT == "production":
        if any(k in ("admin", "forti-secret-api-key-change-me", "123456") for k in settings.api_keys):
            logger.warning("⚠️  [ALERTA DE SEGURIDAD] Clave por defecto detectada en producción. Cambie APP_API_KEY a un valor criptográficamente seguro.")
        if not settings.FORTIOS_VERIFY_SSL and not settings.FORTIOS_CA_BUNDLE:
            logger.warning("⚠️  [ALERTA DE SEGURIDAD] FORTIOS_VERIFY_SSL está desactivado en producción. Se recomienda habilitar TLS estricto o configurar FORTIOS_CA_BUNDLE.")

    keepalive_task = asyncio.create_task(_fortios_telemetry_keepalive())
    yield
    keepalive_task.cancel()
    try:
        await keepalive_task
    except asyncio.CancelledError:
        pass
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
    Para consumir estos endpoints se requiere enviar la cabecera `X-API-Key` o `Authorization: Bearer <token>` con la clave configurada en el servidor.
    """,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.ENABLE_DOCS else None,
    lifespan=lifespan,
)

# Integrar Rate Limiter de slowapi (para compatibilidad de dependencias)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# -------------------------------------------------------------
# Middlewares de Seguridad y Trazabilidad (orden de ejecución LIFO)
# -------------------------------------------------------------

# 1. Cabeceras OWASP y control de caché
app.add_middleware(SecurityHeadersMiddleware)

# 2. Limitador de peticiones (Sliding Window en memoria)
app.add_middleware(
    RateLimitingMiddleware,
    rate_limit_per_minute=settings.RATE_LIMIT_PER_MINUTE,
    auth_rate_limit_per_minute=settings.AUTH_RATE_LIMIT_PER_MINUTE,
)

# 3. Límite de tamaño de cuerpo de petición (Anti-DoS)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_bytes=settings.MAX_REQUEST_BODY_BYTES,
)

# 4. Inyección de X-Request-ID para trazabilidad y auditoría
app.add_middleware(RequestContextMiddleware)

# 5. TrustedHostMiddleware (si no es comodín '*')
if settings.ALLOWED_HOSTS and "*" not in settings.ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

# 6. CORS Seguro (sin allow_credentials=True si el origen es '*')
origins = settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else [settings.CORS_ORIGINS]
is_cors_wildcard = "*" in origins
has_lan_origins = any(
    isinstance(o, str) and (
        o.startswith("http://192.168.")
        or o.startswith("https://192.168.")
        or o.startswith("http://10.")
        or o.startswith("https://10.")
        or o.startswith("http://172.")
        or o.startswith("https://172.")
        or "localhost" in o
        or "127.0.0.1" in o
    )
    for o in origins
)

allow_all_cors = is_cors_wildcard or has_lan_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"] if allow_all_cors else ["GET", "POST", "OPTIONS"],
    allow_headers=["*"] if allow_all_cors else [
        "Authorization",
        "Content-Type",
        "X-API-Key",
        "X-Request-ID",
        "Accept",
        "User-Agent",
    ],
    expose_headers=["X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
)


# -------------------------------------------------------------
# Manejadores Globales de Excepciones
# -------------------------------------------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Pydantic's default response can echo the input, including API keys/tokens.
    return JSONResponse(status_code=422, content={"success": False, "error": "InvalidRequest", "message": "Parámetros de solicitud no válidos."})


@app.exception_handler(FortiOSBaseException)
async def fortios_exception_handler(request: Request, exc: FortiOSBaseException):
    req_id = getattr(request.state, "request_id", "unknown")
    logger.warning(f"[{req_id}] Excepción FortiOS interceptada [{exc.status_code}]: {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.__class__.__name__,
            "message": exc.message,
            "details": None,
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", "unknown")
    logger.error("[%s] Error no controlado: %s", req_id, type(exc).__name__)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "InternalServerError",
            "message": "Ha ocurrido un error interno en el servidor.",
            "details": None,
        },
    )


# -------------------------------------------------------------
# Endpoint Público Ligero de Ping / Liveness
# -------------------------------------------------------------
@app.get("/health", tags=["Salud y Conectividad"], include_in_schema=False)
async def ping():
    """Liveness probe público para balanceadores y contenedores sin exponer datos de red."""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
    }


# -------------------------------------------------------------
# Documentación Interactiva Scalar (condicionada a ENABLE_DOCS)
# -------------------------------------------------------------
if settings.ENABLE_DOCS:
    @app.get("/scalar", include_in_schema=False)
    async def scalar_html(request: Request):
        base_url = str(request.base_url).rstrip("/")
        return get_scalar_api_reference(
            openapi_url=app.openapi_url,
            title=f"{settings.APP_NAME} - Scalar Docs",
            servers=[{"url": base_url, "description": f"Servidor API ({base_url})"}],
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
app.include_router(auth_router, prefix=api_v1_prefix)
