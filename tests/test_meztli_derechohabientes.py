import time
import pytest
import dashboard_access as access
from dashboard_meztli import (
    list_derechohabientes,
    create_derechohabiente,
    update_derechohabiente_status,
)


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path / "private")
    return access.save_user({"username": "root.local", "name": "Responsable local", "role": "super-admin", "password": "Ejemplo-local-2026"}, bootstrap=True)


def test_meztli_derechohabientes_lifecycle(local_store):
    # 1. Create a derechohabiente ticket
    data = {
        "patient_name": "Juan Perez Gonzalez",
        "start_date": "2026-10-07",
        "end_date": "2026-10-10",
        "entry_time": "08:30",
        "exit_time": "18:00",
        "department": "Trabajo Social",
        "room_bed": "Cama 105",
        "notes": "Acceso temporal para teleconsulta médica",
        "requested_by": "Lic. Silvia Cruz",
    }
    ticket = create_derechohabiente(data, local_store["id"], "Admin NOC")
    assert ticket["id"].startswith("dh_")
    assert ticket["folio"].startswith("DH-")
    assert ticket["patient_name"] == "Juan Perez Gonzalez"
    assert ticket["status"] == "pending"
    assert ticket["start_date"] == "2026-10-07"
    assert ticket["end_date"] == "2026-10-10"

    # 2. List tickets
    items = list_derechohabientes()
    assert len(items) >= 1
    found = next((t for t in items if t["id"] == ticket["id"]), None)
    assert found is not None
    assert found["folio"] == ticket["folio"]

    # Filter by status
    pending = list_derechohabientes(status="pending")
    assert any(t["id"] == ticket["id"] for t in pending)

    attended = list_derechohabientes(status="attended")
    assert not any(t["id"] == ticket["id"] for t in attended)

    # 3. Mark as attended
    updated = update_derechohabiente_status(
        ticket["id"],
        "attended",
        local_store["id"],
        "Operador NOC",
        response_notes="Acceso habilitado en SSID-Meztli",
    )
    assert updated["status"] == "attended"
    assert updated["attended_by"] == "Operador NOC"
    assert updated["response_notes"] == "Acceso habilitado en SSID-Meztli"
    assert updated["attended_at"] is not None

    # Verify status changed in list
    now_attended = list_derechohabientes(status="attended")
    assert any(t["id"] == ticket["id"] for t in now_attended)


def test_create_derechohabiente_validation():
    # Invalid patient name
    with pytest.raises(access.AccessError) as exc:
        create_derechohabiente({"patient_name": "AB"}, "user1", "Operador")
    assert exc.value.status == 422

    # Invalid dates (end < start)
    with pytest.raises(access.AccessError) as exc:
        create_derechohabiente({
            "patient_name": "Valeria Morales",
            "start_date": "2026-10-10",
            "end_date": "2026-10-05",
            "entry_time": "08:00",
            "exit_time": "18:00",
        }, "user1", "Operador")
    assert exc.value.status == 422

    # Invalid status update
    with pytest.raises(access.AccessError) as exc:
        update_derechohabiente_status("dh_unknown", "invalid_status", "user1", "Operador")
    assert exc.value.status == 422
