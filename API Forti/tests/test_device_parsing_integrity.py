import time
import pytest
from app.routers.devices import _parse_device, list_connected_devices
from app.schemas.devices import DeviceItem

def test_parse_device_historical_cache_is_marked_offline():
    """
    Asegura que registros históricos de FortiOS con 'is_online: True' y 'online_interfaces: [...]'
    vistos hace horas o días NUNCA se clasifiquen como online.
    """
    now = time.time()
    old_raw_device = {
        "mac": "d4:f0:c9:01:f5:eb",
        "ip": "15.40.11.20",
        "hostname": "KM01F5EB",
        "is_online": True,  # FortiOS lo devuelve en True en su caché
        "online_interfaces": ["Printer"],  # FortiOS lo conserva en caché
        "last_seen": now - (7 * 86400),  # Visto hace 7 días
    }

    parsed = _parse_device(old_raw_device, current_time=now, active_window_seconds=390)
    assert parsed.is_online is False, "Un dispositivo visto hace 7 días debe ser OFFLINE"


def test_parse_device_active_device_is_marked_online():
    """
    Asegura que un dispositivo con actividad reciente (dentro de los 390 segundos)
    sea marcado como online.
    """
    now = time.time()
    active_raw_device = {
        "mac": "a0:b3:39:35:1a:d8",
        "ip": "15.40.1.39",
        "hostname": "LAPTOP-MEDICO-01",
        "is_online": True,
        "online_interfaces": ["SSID-Quetzacoat"],
        "last_seen": now - 120,  # Visto hace 2 minutos
    }

    parsed = _parse_device(active_raw_device, current_time=now, active_window_seconds=390)
    assert parsed.is_online is True, "Un dispositivo visto hace 2 minutos debe ser ONLINE"


def test_parse_device_missing_or_null_last_seen_is_offline():
    """
    Asegura que dispositivos sin last_seen o con timestamp 0 sean offline.
    """
    now = time.time()
    device_no_timestamp = {
        "mac": "00:11:22:33:44:55",
        "hostname": "UNKNOWN-DEV",
        "is_online": True,
        "online_interfaces": ["DATA"],
        "last_seen": None,
    }

    parsed = _parse_device(device_no_timestamp, current_time=now, active_window_seconds=390)
    assert parsed.is_online is False, "Sin last_seen válido debe ser OFFLINE"


def test_online_offline_sum_equals_total_inventory():
    """
    Garantiza que la suma de online_devices + offline_devices sea matemáticamente
    igual al 100% de total_inventory.
    """
    now = time.time()
    raw_devices = [
        {"mac": f"00:00:00:00:00:{i:02x}", "last_seen": now - (100 if i < 10 else 5000), "is_online": True}
        for i in range(50)
    ]

    all_parsed = [_parse_device(d, current_time=now, active_window_seconds=390) for d in raw_devices]
    online_count = sum(1 for d in all_parsed if d.is_online)
    offline_count = sum(1 for d in all_parsed if not d.is_online)

    assert online_count == 10
    assert offline_count == 40
    assert online_count + offline_count == len(raw_devices)
