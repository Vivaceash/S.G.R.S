import time
import uuid
import threading
from collections import defaultdict, deque
from typing import Dict, Deque, Tuple
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from app.config import settings


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
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Content-Security-Policy: estricto para APIs, permisivo para Scalar UI
        path = request.url.path
        if path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
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

    def __init__(self, app, rate_limit_per_minute: int = 60):
        super().__init__(app)
        self.rate_limit = rate_limit_per_minute
        self.window_seconds = 60.0
        self.requests: Dict[str, Deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()
        self._last_cleanup = time.time()

    def _get_client_ip(self, request: Request) -> str:
        """Extrae la IP real del cliente considerando proxies y balanceadores"""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # En caso de múltiples IPs, la primera es la del cliente original
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
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
        now = time.time()

        with self.lock:
            self._cleanup_stale_ips(now)
            timestamps = self.requests[client_ip]
            # Eliminar peticiones fuera de la ventana actual de 60 segundos
            while timestamps and timestamps[0] <= now - self.window_seconds:
                timestamps.popleft()

            # Comprobar límite
            current_count = len(timestamps)
            if current_count >= self.rate_limit:
                retry_after = int(self.window_seconds - (now - timestamps[0])) + 1
                return JSONResponse(
                    status_code=429,
                    content={
                        "success": False,
                        "message": "Demasiadas solicitudes. Límite de tasa excedido.",
                        "error": f"Has alcanzado el límite de {self.rate_limit} peticiones por minuto. Intenta de nuevo en {retry_after} segundos.",
                        "data": None
                    },
                    headers={
                        "Retry-After": str(max(1, retry_after)),
                        "X-RateLimit-Limit": str(self.rate_limit),
                        "X-RateLimit-Remaining": "0"
                    }
                )

            timestamps.append(now)
            remaining = self.rate_limit - len(timestamps)

        response: Response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.rate_limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))
        return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Asigna un identificador único (X-Request-ID) a cada solicitud para trazabilidad y auditoría.
    Permite correlacionar peticiones en los logs del servidor sin exponer datos sensibles.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming_req_id = request.headers.get("X-Request-ID")
        # Si el cliente no envía uno o es inválido, generamos un UUID4 criptoseguro
        request_id = incoming_req_id.strip() if incoming_req_id and len(incoming_req_id) <= 64 else str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Protección contra DoS por agotamiento de memoria bloqueando solicitudes
    cuyo encabezado Content-Length exceda el tamaño máximo configurado.
    """

    def __init__(self, app, max_bytes: int = 1_048_576):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                length = int(content_length)
                if length > self.max_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "success": False,
                            "error": "PayloadTooLarge",
                            "message": f"El cuerpo de la petición excede el tamaño máximo permitido ({self.max_bytes} bytes).",
                            "data": None,
                        },
                    )
            except ValueError:
                pass

        return await call_next(request)
