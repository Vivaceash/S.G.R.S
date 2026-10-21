import asyncio
from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware
from scalar_fastapi import get_scalar_api_reference
from app.core.config import settings
from app.core.errors import InventoryError
from app.clients.providers import Providers
from app.services.reconciliation import Reconciler
from app.middleware.security import SecurityHeadersMiddleware, RateLimitingMiddleware, RequestContextMiddleware, RequestSizeLimitMiddleware
from app.routers import auth, cctv, catalogs
from app.schemas.common import ErrorResponse


@asynccontextmanager
async def lifespan(app):
    providers = Providers()
    reconciler = Reconciler(providers)
    reconciler.recover()
    app.state.reconciler = reconciler
    periodic = asyncio.create_task(reconciler.periodic()) if settings.REFRESH_SECONDS else None
    yield
    if periodic:
        periodic.cancel()
        await asyncio.gather(periodic, return_exceptions=True)
    await reconciler.close()
    await providers.close()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION,
              description='Inventario CCTV documental, correcciones auditadas y observaciones de red Forti/Omni. La baja administrativa no apaga equipos.',
              openapi_tags=[
                  {'name': 'Salud', 'description': 'Comprobaciones públicas y autenticadas del servicio, almacenamiento y proveedores.'},
                  {'name': 'Autenticación y 2FA', 'description': 'Estado de autenticación, enrolamiento TOTP y emisión/verificación de sesiones.'},
                  {'name': 'CCTV', 'description': 'Catálogo, consulta, exportación, correcciones e historial de cámaras CCTV.'},
                  {'name': 'Bitacora', 'description': 'Consulta de visitas e incidencias registradas en los IDF. Permite filtrar por IDF, estado, severidad o texto, ordenar y paginar. Las rutas son de solo lectura y requieren credencial de lectura mediante X-API-Key o Bearer.'},
                  {'name': 'Catálogos', 'description': 'Catálogos de gabinetes e información de redes documentadas y observadas.'},
                  {'name': 'Fuentes documentales', 'description': 'Fuentes importadas y descarga controlada de los archivos originales.'},
                  {'name': 'Cotejo de red', 'description': 'Ejecución y consulta de trabajos que comparan inventario documental contra Forti/Omni.'},
              ],
              docs_url=None, redoc_url=None, openapi_url='/openapi.json' if settings.ENABLE_DOCS else None,
              lifespan=lifespan, responses={code: {'model': ErrorResponse} for code in (401, 403, 404, 409, 422, 503)})
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_methods=['GET', 'POST', 'PATCH', 'OPTIONS'],
                   allow_headers=['Content-Type', 'X-API-Key', 'Authorization', 'X-Request-ID'], expose_headers=['X-Request-ID'])
app.add_middleware(RateLimitingMiddleware, rate_limit_per_minute=settings.RATE_LIMIT_PER_MINUTE, auth_rate_limit_per_minute=settings.AUTH_RATE_LIMIT_PER_MINUTE)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.MAX_REQUEST_BODY_BYTES)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)


def error(request, status, message, code):
    return JSONResponse(status_code=status, content={'success': False, 'message': message, 'error': code,
                                                    'request_id': getattr(request.state, 'request_id', None)})


@app.exception_handler(InventoryError)
async def inventory_error(request: Request, exc: InventoryError):
    return error(request, exc.status, exc.message, exc.code)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return error(request, 422, 'Parámetros no válidos. Revisa el contrato en Scalar.', 'validation_error')


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return error(request, exc.status_code, str(exc.detail), 'http_error')


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception):
    logging.getLogger('inventarios_api').error('request=%s type=%s', getattr(request.state, 'request_id', ''), type(exc).__name__)
    return error(request, 500, 'No se pudo procesar la solicitud.', 'internal_error')


@app.get('/health', tags=['Salud'], summary='Comprobar disponibilidad',
         description='Liveness probe público para balanceadores y monitores. No expone estado detallado de proveedores ni del almacenamiento.')
def health():
    return {'status': 'healthy', 'app': settings.APP_NAME, 'version': settings.APP_VERSION}


@app.get('/docs', include_in_schema=False)
def docs(request: Request):
    if not settings.ENABLE_DOCS:
        raise InventoryError(404, 'Documentación deshabilitada.')
    return get_scalar_api_reference(openapi_url=app.openapi_url, title=settings.APP_NAME + ' - Scalar',
                                    servers=[{'url': str(request.base_url).rstrip('/')}], persist_auth=True,
                                    show_sidebar=True, default_open_all_tags=True, hide_models=False,
                                    with_default_fonts=False)


@app.get('/', include_in_schema=False)
@app.get('/scalar', include_in_schema=False)
@app.get('/swagger', include_in_schema=False)
def docs_alias():
    if not settings.ENABLE_DOCS:
        raise InventoryError(404, 'Documentación deshabilitada.')
    return RedirectResponse('/docs')


for router in (auth.router, cctv.router, cctv.reports_router, catalogs.router, catalogs.health_router):
    app.include_router(router, prefix='/api/v1')
