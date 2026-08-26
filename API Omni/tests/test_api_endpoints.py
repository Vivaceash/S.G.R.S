import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_endpoint():
    """Prueba del endpoint de salud del sistema"""
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "omnivista_connected" in data["data"]
    assert data["data"]["omnivista_connected"] is True


def test_access_role_profiles_catalog():
    """Prueba del catálogo de perfiles de acceso (SSIDs)"""
    response = client.get("/api/v1/catalogs/access-role-profiles")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    profiles = data["data"]["profiles"]
    assert isinstance(profiles, list)
    assert len(profiles) > 0
    print(f"\n[OK] Perfiles de red detectados: {profiles}")


def test_device_options_catalog():
    """Prueba del catálogo de opciones de dispositivos"""
    response = client.get("/api/v1/catalogs/device-options")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "categories" in data["data"]
    assert "operating_systems" in data["data"]


def test_list_employees():
    """Prueba de consulta del listado de empleados"""
    response = client.get("/api/v1/employees?page=1&page_size=5")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert data["data"]["total"] > 0
    print(f"\n[OK] Total de empleados encontrados: {data['data']['total']}")


def test_list_company_properties():
    """Prueba de consulta de dispositivos / MACs en Company Property"""
    response = client.get("/api/v1/company-properties?page=1&page_size=5")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert data["data"]["total"] > 0
    print(f"\n[OK] Total de MACs registradas en Company Property: {data['data']['total']}")


def test_infrastructure_stats():
    """Prueba de métricas de infraestructura"""
    response = client.get("/api/v1/monitoring/infrastructure-stats")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    stats = data["data"]
    assert stats["totalDevices"] > 0
    print(f"\n[OK] Métricas: {stats['totalDevices']} equipos ({stats['accessPointsCount']} APs, {stats['switchesCount']} switches)")


def test_scalar_docs_endpoint():
    """Prueba de disponibilidad de la documentación Scalar en /docs"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "scalar" in response.text.lower() or "openapi" in response.text.lower() or "<html" in response.text.lower()


def test_openapi_json_endpoint():
    """Prueba de la especificación OpenAPI 3.1 en /openapi.json"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    assert "paths" in spec
    assert "/api/v1/enrollment/complete-user" in spec["paths"]
    assert "/api/v1/employees" in spec["paths"]
    assert "/api/v1/company-properties" in spec["paths"]
