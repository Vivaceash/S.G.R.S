import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

client = TestClient(app)
VALID_API_KEY = settings.API_SECRET_KEY or "admin"


def test_production_rejects_development_admin_key():
    """La comodidad local `admin` no puede llegar accidentalmente a producción."""
    from pydantic import ValidationError
    from app.config import Settings

    with pytest.raises(ValidationError, match="APP_API_KEY"):
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            DEBUG=False,
            APP_API_KEY="admin",
            JWT_SECRET_KEY="a-production-jwt-secret-with-more-than-32-bytes",
            OV_VERIFY_SSL=True,
            ALLOWED_HOSTS=["api.example.test"],
            CORS_ORIGINS=["https://dashboard.example.test"],
        )


# =============================================================================
# 1. Pruebas de Documentación, Liveness Probe y Especificación OpenAPI
# =============================================================================

def test_public_health_liveness_probe():
    """Verifica que el endpoint /health público responda 200 sin autenticación ni fuga de datos"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "healthy"
    assert "omnivista_connected" not in data
    assert "OmniVista" in data.get("app", "")


def test_scalar_docs_endpoint():
    """Prueba de disponibilidad de la documentación Scalar en /docs y ausencia de Swagger"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "scalar" in response.text.lower()
    assert "swagger-ui" not in response.text.lower()

    # /scalar y /swagger deben redirigir a /docs
    res_scalar = client.get("/scalar", follow_redirects=False)
    assert res_scalar.status_code in (302, 307)
    assert res_scalar.headers["location"] == "/docs"

    res_swagger = client.get("/swagger", follow_redirects=False)
    assert res_swagger.status_code in (302, 307)
    assert res_swagger.headers["location"] == "/docs"


def test_openapi_json_endpoint():
    """Prueba de la especificación OpenAPI en /openapi.json y verificación de métodos de solo lectura"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    paths = spec.get("paths", {})

    # Endpoints de consulta deben existir
    assert "/api/v1/employees" in paths
    assert "/api/v1/company-properties" in paths
    assert "/api/v1/monitoring/infrastructure-stats" in paths
    assert "/api/v1/monitoring/devices" in paths
    assert "/api/v1/monitoring/online-devices" in paths
    assert "/api/v1/monitoring/topology" in paths
    assert "/api/v1/monitoring/notifications" in paths
    assert "/api/v1/catalogs/access-role-profiles" in paths
    assert "/api/v1/catalogs/vlans" in paths
    assert "/api/v1/system/health" in paths
    assert "/api/v1/system/version" in paths

    # Endpoints de mutación sobre recursos de red NO deben existir
    assert "/api/v1/enrollment/complete-user" not in paths
    for path, methods in paths.items():
        if path.startswith("/api/v1/auth"):
            continue  # Endpoints de autenticación 2FA usan POST
        assert "post" not in methods, f"Endpoint de consulta {path} tiene POST no permitido"
        assert "put" not in methods, f"Endpoint {path} tiene PUT no permitido"
        assert "delete" not in methods, f"Endpoint {path} tiene DELETE no permitido"
        assert "patch" not in methods, f"Endpoint {path} tiene PATCH no permitido"



# =============================================================================
# 2. Pruebas de Autenticación y Control de Acceso
# =============================================================================

def test_unauthorized_access_rejected():
    """Verifica que peticiones sin API Key sean rechazadas con HTTP 401"""
    # Catálogos
    res_cat = client.get("/api/v1/catalogs/device-options")
    assert res_cat.status_code == 401
    assert "no autorizado" in res_cat.json()["detail"].lower()

    # Empleados
    res_emp = client.get("/api/v1/employees")
    assert res_emp.status_code == 401

    # Company properties
    res_prop = client.get("/api/v1/company-properties")
    assert res_prop.status_code == 401

    # Sistema / Versión
    res_ver = client.get("/api/v1/system/version")
    assert res_ver.status_code == 401


def test_public_health_endpoints_without_auth():
    """Verifica que /api/v1/health y /api/v1/system/health no requieran autenticación"""
    res_h1 = client.get("/api/v1/health")
    assert res_h1.status_code == 200
    assert "data" in res_h1.json()

    res_h2 = client.get("/api/v1/system/health")
    assert res_h2.status_code == 200
    assert "data" in res_h2.json()


def test_invalid_api_key_rejected():
    """Verifica que una clave errónea sea rechazada con HTTP 401"""
    headers = {"X-API-KEY": "clave_totalmente_falsa_12345"}
    res = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert res.status_code == 401
    assert "no válida" in res.json()["detail"].lower()


def test_authorized_access_with_header_x_api_key():
    """Verifica acceso exitoso mediante cabecera X-API-KEY y X-API-Key"""
    # Formato mayúsculas
    headers_upper = {"X-API-KEY": VALID_API_KEY}
    response_upper = client.get("/api/v1/catalogs/device-options", headers=headers_upper)
    assert response_upper.status_code == 200
    assert response_upper.json()["success"] is True

    # Formato camelCase
    headers_lower = {"X-API-Key": VALID_API_KEY}
    response_lower = client.get("/api/v1/catalogs/device-options", headers=headers_lower)
    assert response_lower.status_code == 200
    assert response_lower.json()["success"] is True


def test_authorized_access_with_bearer_token():
    """Verifica acceso exitoso mediante cabecera Authorization: Bearer"""
    headers = {"Authorization": f"Bearer {VALID_API_KEY}"}
    response = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


# =============================================================================
# 3. Pruebas de Cabeceras de Seguridad OWASP y Trazabilidad
# =============================================================================

def test_owasp_security_headers_present():
    """Verifica la inyección de todas las cabeceras HTTP de seguridad recomendadas por OWASP"""
    headers_auth = {"X-API-KEY": VALID_API_KEY}
    response = client.get("/api/v1/system/health", headers=headers_auth)
    headers = response.headers

    assert headers.get("X-Content-Type-Options") == "nosniff"
    assert headers.get("X-Frame-Options") == "DENY"
    assert headers.get("X-XSS-Protection") == "0"
    assert headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "Permissions-Policy" in headers
    assert "Content-Security-Policy" in headers
    assert "X-Request-ID" in headers
    assert "X-RateLimit-Limit" in headers
    assert "X-RateLimit-Remaining" in headers


# =============================================================================
# 4. Pruebas de Diagnóstico y Enmascaramiento de IPs Internas
# =============================================================================

def test_health_endpoint_masks_internal_ip():
    """Prueba del endpoint de salud autenticado y confirmación de que no se divulga la IP interna completa"""
    headers_auth = {"X-API-KEY": VALID_API_KEY}
    response = client.get("/api/v1/system/health", headers=headers_auth)
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "omnivista_connected" in data["data"]
    host = data["data"].get("omnivista_host", "")
    # Debe estar enmascarado si MASK_INTERNAL_IPS está activo
    if settings.MASK_INTERNAL_IPS and host:
        assert "***" in host


# =============================================================================
# 5. Pruebas de Validación Estricta de Entradas
# =============================================================================

def test_invalid_ip_format_rejected():
    """Verifica que direcciones IP inválidas en la ruta sean rechazadas con HTTP 400"""
    headers = {"X-API-KEY": VALID_API_KEY}
    response = client.get("/api/v1/monitoring/devices/direccion-ip-totalmente-invalida", headers=headers)
    assert response.status_code == 400
    assert "no válida" in response.json()["detail"].lower()


def test_invalid_username_characters_rejected():
    """Verifica que caracteres peligrosos en username sean rechazados con HTTP 400"""
    headers = {"X-API-KEY": VALID_API_KEY}
    response = client.get("/api/v1/employees/../../etc/passwd", headers=headers)
    assert response.status_code in (400, 404)


# =============================================================================
# 6. Pruebas de Rate Limiting y Control de Ráfagas
# =============================================================================

def test_rate_limiter_decrements_remaining():
    """Verifica que las peticiones sucesivas descuenten de X-RateLimit-Remaining"""
    ip_test = "203.0.113.50"
    headers = {"X-Forwarded-For": ip_test, "X-API-KEY": VALID_API_KEY}

    res1 = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert res1.status_code == 200
    rem1 = int(res1.headers["X-RateLimit-Remaining"])

    res2 = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert res2.status_code == 200
    rem2 = int(res2.headers["X-RateLimit-Remaining"])

    assert rem2 == rem1 - 1


def test_rate_limiter_blocks_exceeded_requests():
    """Verifica que al saturar el límite se devuelva HTTP 429 con Retry-After"""
    import time
    from collections import deque

    headers = {"X-Forwarded-For": "203.0.113.99", "X-API-KEY": VALID_API_KEY}

    curr = app.middleware_stack
    rl_middleware = None
    while curr:
        if hasattr(curr, "requests") and hasattr(curr, "rate_limit"):
            rl_middleware = curr
            break
        curr = getattr(curr, "app", None)

    if rl_middleware:
        client.get("/api/v1/catalogs/device-options", headers=headers)
        bucket_key = next(key for key in rl_middleware.requests if key.endswith(":api"))
        now = time.time()
        with rl_middleware.lock:
            rl_middleware.requests[bucket_key] = deque([now] * rl_middleware.rate_limit)

        res_blocked = client.get("/api/v1/catalogs/device-options", headers=headers)
        assert res_blocked.status_code == 429
        assert "Retry-After" in res_blocked.headers
        assert res_blocked.headers["X-RateLimit-Remaining"] == "0"
        assert res_blocked.json()["success"] is False
        with rl_middleware.lock:
            rl_middleware.requests.pop(bucket_key, None)


# =============================================================================
# 7. Pruebas de Límite de Tamaño de Cuerpo (Anti-DoS)
# =============================================================================

def test_request_size_limit_blocks_large_payload():
    """Verifica que peticiones que excedan MAX_REQUEST_BODY_BYTES sean bloqueadas con HTTP 413"""
    headers = {
        "X-API-KEY": VALID_API_KEY,
        "Content-Length": str(settings.MAX_REQUEST_BODY_BYTES + 500)
    }
    response = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert response.status_code == 413
    assert response.json()["error"] == "PayloadTooLarge"


# =============================================================================
# 8. Pruebas de Métodos Prohibidos y 405 Method Not Allowed
# =============================================================================

def test_disallowed_mutation_methods_rejected():
    """Verifica que métodos de mutación (POST) en endpoints de solo lectura retornen 405"""
    headers = {"X-API-KEY": VALID_API_KEY}
    response = client.post("/api/v1/employees", json={"test": "data"}, headers=headers)
    assert response.status_code == 405


# =============================================================================
# 9. Pruebas del Módulo 2FA (TOTP RFC 6238) y Sesiones JWT
# =============================================================================

def test_auth_status_endpoint():
    """Verifica el estado del módulo de autenticación y 2FA"""
    response = client.get("/api/v1/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "mode" in data
    assert "2fa_enabled" in data


def test_2fa_setup_and_verify_flow(monkeypatch):
    """Verifica el flujo completo de enrolamiento 2FA, generación TOTP y validación de sesión JWT"""
    from app.dependencies import get_totp_token

    monkeypatch.setattr(settings, "ENABLE_2FA", True)
    monkeypatch.setattr(settings, "ALLOW_2FA_ENROLLMENT", True)
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "omni-test-jwt-secret-with-at-least-32-bytes")

    # 1. Setup 2FA con clave de API
    res_setup = client.post(
        "/api/v1/auth/setup-2fa",
        json={"api_key": VALID_API_KEY, "account_name": "NOC-Admin"},
    )
    assert res_setup.status_code == 200
    setup_data = res_setup.json()
    assert setup_data["success"] is True
    secret = setup_data["secret"]
    assert "otpauth://" in setup_data["otpauth_uri"]

    # 2. Generar código TOTP válido
    totp_code = get_totp_token(secret)

    # 3. Verificar código y obtener token de sesión
    res_verify = client.post(
        "/api/v1/auth/verify-2fa",
        json={
            "api_key": VALID_API_KEY,
            "totp_code": totp_code,
            "account_name": "NOC-Admin",
        },
    )
    assert res_verify.status_code == 200
    verify_data = res_verify.json()
    assert verify_data["success"] is True
    token = verify_data["access_token"]
    assert len(token.split(".")) == 3

    # 4. Consumir endpoint protegido usando el token Bearer emitido
    res_query = client.get(
        "/api/v1/catalogs/device-options",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_query.status_code == 200

    # 5. Rechazar código TOTP inválido
    res_bad = client.post(
        "/api/v1/auth/verify-2fa",
        json={
            "api_key": VALID_API_KEY,
            "totp_code": "999999",
            "account_name": "NOC-Admin",
        },
    )
    assert res_bad.status_code == 401


def test_untrusted_forwarded_for_does_not_create_spoofed_bucket():
    headers = {"X-Forwarded-For": "198.51.100.123", "X-API-KEY": VALID_API_KEY}
    response = client.get("/api/v1/catalogs/device-options", headers=headers)
    assert response.status_code == 200

    curr = app.middleware_stack
    while curr and not hasattr(curr, "requests"):
        curr = getattr(curr, "app", None)
    assert curr is not None
    assert "198.51.100.123:api" not in curr.requests


def test_legacy_or_incomplete_jwt_is_rejected():
    import base64
    import hashlib
    import hmac
    import json
    from app.dependencies import decode_jwt_session

    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    header = encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = encode(json.dumps({"2fa_verified": True}).encode())
    signature = encode(hmac.new(settings.JWT_SECRET_KEY.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())

    assert decode_jwt_session(f"{header}.{payload}.{signature}") is None

