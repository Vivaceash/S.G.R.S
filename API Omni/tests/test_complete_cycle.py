import uuid
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_complete_enrollment_and_deletion_cycle():
    """Prueba del ciclo completo: Alta de Usuario + MAC, Consulta, Modificación y Baja"""
    unique_suffix = uuid.uuid4().hex[:6]
    test_user = f"test.user.{unique_suffix}"
    test_mac = f"AA:BB:CC:{unique_suffix[:2]}:{unique_suffix[2:4]}:{unique_suffix[4:6]}"
    normalized_mac = f"AABBCC{unique_suffix.upper()}"

    print(f"\n[1] Probando Alta Unificada para {test_user} con MAC {test_mac}...")
    enroll_payload = {
        "username": test_user,
        "password": "Password123#",
        "repeatPassword": "Password123#",
        "fullName": "Usuario Prueba API",
        "telephone": "5551234567",
        "email": f"{test_user}@empresa.com",
        "department": "Sistemas",
        "position": "Ingeniero de Pruebas",
        "description": "Alta automatizada de prueba",
        "accessRoleProfile": "__SSID-Ehecatl",
        "deviceMac": test_mac,
        "deviceCategory": "Mobile",
        "deviceFamily": "Android",
        "deviceOS": "Android"
    }

    res_create = client.post("/api/v1/enrollment/complete-user", json=enroll_payload)
    print("  -> Status POST /api/v1/enrollment/complete-user:", res_create.status_code)
    print("  -> Response:", res_create.json())
    assert res_create.status_code == 201
    assert res_create.json()["success"] is True

    # 2. Consultar empleado
    print(f"\n[2] Verificando existencia de {test_user} en /api/v1/employees/{test_user}...")
    res_get_emp = client.get(f"/api/v1/employees/{test_user}")
    print("  -> Status:", res_get_emp.status_code)
    assert res_get_emp.status_code == 200
    assert res_get_emp.json()["data"]["username"] == test_user

    # 3. Consultar MAC en Company Property
    print(f"\n[3] Verificando existencia de MAC {normalized_mac} en /api/v1/company-properties/{normalized_mac}...")
    res_get_mac = client.get(f"/api/v1/company-properties/{normalized_mac}")
    print("  -> Status:", res_get_mac.status_code)
    assert res_get_mac.status_code == 200
    assert res_get_mac.json()["data"]["deviceMac"] == normalized_mac

    # 4. Modificar empleado
    print(f"\n[4] Modificando departamento a 'Dirección General'...")
    res_update = client.put(f"/api/v1/employees/{test_user}", json={"department": "Dirección General"})
    print("  -> Status:", res_update.status_code)
    assert res_update.status_code == 200

    # 5. Dar de baja / Eliminar MAC
    print(f"\n[5] Eliminando MAC {normalized_mac}...")
    res_del_mac = client.delete(f"/api/v1/company-properties/{normalized_mac}")
    print("  -> Status:", res_del_mac.status_code)
    assert res_del_mac.status_code == 200

    # 6. Dar de baja / Eliminar empleado
    print(f"\n[6] Eliminando cuenta de empleado {test_user}...")
    res_del_emp = client.delete(f"/api/v1/employees/{test_user}")
    print("  -> Status:", res_del_emp.status_code)
    assert res_del_emp.status_code == 200

    print("\n[+] Ciclo completo de Alta, Consulta, Modificación y Baja probado con éxito total!")
