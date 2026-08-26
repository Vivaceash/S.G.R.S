import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_scalar_docs_endpoint():
    """Prueba de disponibilidad de la documentación Scalar en /docs y ausencia de Swagger"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "scalar" in response.text.lower()
    # Swagger no debe estar presente en el HTML
    assert "swagger-ui" not in response.text.lower()

    # /scalar y /swagger deben redirigir a /docs
    res_scalar = client.get("/scalar", follow_redirects=False)
    assert res_scalar.status_code in (302, 307)
    assert res_scalar.headers["location"] == "/docs"

    res_swagger = client.get("/swagger", follow_redirects=False)
    assert res_swagger.status_code in (302, 307)
    assert res_swagger.headers["location"] == "/docs"


def test_openapi_json_endpoint():
    """Prueba de la especificación OpenAPI en /openapi.json y verificación de ausencia de rutas de mutación"""
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

    # Endpoints de mutación NO deben existir
    assert "/api/v1/enrollment/complete-user" not in paths
    for path, methods in paths.items():
        assert "post" not in methods, f"Endpoint {path} tiene POST no permitido"
        assert "put" not in methods, f"Endpoint {path} tiene PUT no permitido"
        assert "delete" not in methods, f"Endpoint {path} tiene DELETE no permitido"
        assert "patch" not in methods, f"Endpoint {path} tiene PATCH no permitido"


def test_health_endpoint():
    """Prueba del endpoint de salud del sistema"""
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "omnivista_connected" in data["data"]


def test_device_options_catalog():
    """Prueba del catálogo estático de opciones de dispositivos"""
    response = client.get("/api/v1/catalogs/device-options")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "categories" in data["data"]
    assert "operating_systems" in data["data"]
