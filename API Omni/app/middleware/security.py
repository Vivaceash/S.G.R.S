import time
import uuid
import threading
import ipaddress
import re
from collections import defaultdict, deque
from typing import Dict, Deque, Optional
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from app.config import settings


_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,64}$")


def _trusted_forwarded_ip(request: Request) -> Optional[str]:
    if not request.client or not settings.TRUSTED_PROXY_IPS:
        return None
    try:
        peer_ip = ipaddress.ip_address(request.client.host)
    except ValueError:
        return None

    trusted = False
    for configured_proxy in settings.TRUSTED_PROXY_IPS:
        try:
            if peer_ip in ipaddress.ip_network(configured_proxy, strict=False):
                trusted = True
                break
        except ValueError:
            continue
    if not trusted:
        return None

    candidate = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if not candidate:
        candidate = request.headers.get("X-Real-IP", "").strip()
    try:
        return str(ipaddress.ip_address(candidate)) if candidate else None
    except ValueError:
        return None


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Inyecta cabeceras HTTP de seguridad recomendadas por OWASP en todas las respuestas.
    Protege contra ataques de clickjacking, MIME sniffing, XSS y fijación de protocolo.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)

        # Cabeceras estándar de protección OWASP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=()"
        )

        # HSTS (HTTP Strict Transport Security)
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Content-Security-Policy: estricto para APIs, permisivo para Scalar UI
        path = request.url.path
        if path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        else:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self' https: 'unsafe-inline' 'unsafe-eval' data:; frame-ancestors 'none'"
            )

        return response


class RateLimitingMiddleware(BaseHTTPMiddleware):
    """
    Limitador de tasa de peticiones en memoria mediante ventana deslizante (Sliding Window).
    Previene ataques DoS, fuerza bruta a la API key y agotamiento de recursos del NMS.
    """

    def __init__(self, app, rate_limit_per_minute: int = 60, auth_rate_limit_per_minute: int = 10):
        super().__init__(app)
        self.rate_limit = rate_limit_per_minute
        self.auth_rate_limit = auth_rate_limit_per_minute
        self.window_seconds = 60.0
        self.requests: Dict[str, Deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()
        self._last_cleanup = time.time()

    def _get_client_ip(self, request: Request) -> str:
        """Extrae la IP real del cliente considerando proxies y balanceadores"""
        forwarded_ip = _trusted_forwarded_ip(request)
        if forwarded_ip:
            return forwarded_ip
        if request.client:
            return request.client.host
        return "127.0.0.1"

    def _cleanup_stale_ips(self, now: float):
        """Purga IPs inactivas cada 5 minutos para evitar fugas de memoria"""
        if now - self._last_cleanup < 300:
            return
        self._last_cleanup = now
        stale_threshold = now - self.window_seconds
        ips_to_remove = [
            ip for ip, timestamps in self.requests.items()
            if not timestamps or timestamps[-1] < stale_threshold
        ]
        for ip in ips_to_remove:
            self.requests.pop(ip, None)

    async def dispatch(self, request: Request, call_next) -> Response:
        # Eximir preflight OPTIONS de CORS y rutas de documentación de rate limit estricto
        if request.method == "OPTIONS":
            return await call_next(request)

        # Si el rate limit está deshabilitado (<= 0)
        if self.rate_limit <= 0:
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        is_auth_path = request.url.path.startswith("/api/v1/auth/")
        effective_limit = self.auth_rate_limit if is_auth_path else self.rate_limit
        bucket_key = f"{client_ip}:auth" if is_auth_path else f"{client_ip}:api"
        now = time.time()

        with self.lock:
            self._cleanup_stale_ips(now)
            timestamps = self.requests[bucket_key]
            # Eliminar peticiones fuera de la ventana actual de 60 segundos
            while timestamps and timestamps[0] <= now - self.window_seconds:
                timestamps.popleft()

            # Comprobar límite
            current_count = len(timestamps)
            if current_count >= effective_limit:
                retry_after = int(self.window_seconds - (now - timestamps[0])) + 1
                return JSONResponse(
                    status_code=429,
                    content={
                        "success": False,
                        "message": "Demasiadas solicitudes. Límite de tasa excedido.",
                        "error": f"Has alcanzado el límite de {effective_limit} peticiones por minuto. Intenta de nuevo en {retry_after} segundos.",
                        "data": None
                    },
                    headers={
                        "Retry-After": str(max(1, retry_after)),
                        "X-RateLimit-Limit": str(effective_limit),
                        "X-RateLimit-Remaining": "0"
                    }
                )

            timestamps.append(now)
            remaining = effective_limit - len(timestamps)

        response: Response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(effective_limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))
        return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Asigna un identificador único (X-Request-ID) a cada solicitud para trazabilidad y auditoría.
    Permite correlacionar peticiones en los logs del servidor sin exponer datos sensibles.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming_req_id = request.headers.get("X-Request-ID", "").strip()
        request_id = incoming_req_id if _SAFE_REQUEST_ID.fullmatch(incoming_req_id) else str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestSizeLimitMiddleware:
    """
    Protección contra DoS por agotamiento de memoria bloqueando solicitudes
    cuyo encabezado Content-Length exceda el tamaño máximo configurado.
    """

    def __init__(self, app, max_bytes: int = 1_048_576):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                length = int(content_length.decode("ascii"))
                if length < 0:
                    raise ValueError
            except (ValueError, UnicodeDecodeError):
                response = JSONResponse(status_code=400, content={"success": False, "error": "InvalidContentLength", "data": None})
                await response(scope, receive, send)
                return
            if length > self.max_bytes:
                response = JSONResponse(status_code=413, content={"success": False, "error": "PayloadTooLarge", "message": "El cuerpo excede el límite permitido.", "data": None})
                await response(scope, receive, send)
                return

        buffered_messages = []
        total = 0
        more_body = True
        while more_body:
            message = await receive()
            if message.get("type") != "http.request":
                buffered_messages.append(message)
                break
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                response = JSONResponse(status_code=413, content={"success": False, "error": "PayloadTooLarge", "message": "El cuerpo excede el límite permitido.", "data": None})
                await response(scope, receive, send)
                return
            buffered_messages.append(message)
            more_body = bool(message.get("more_body", False))

        async def replay_receive():
            if buffered_messages:
                return buffered_messages.pop(0)
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)
