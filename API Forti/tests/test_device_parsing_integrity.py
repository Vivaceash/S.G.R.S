import time
import pytest
from app.routers.devices import _parse_device, list_connected_devices


def test_native_online_is_not_overridden_by_local_activity_window():
    result = _parse_device({'mac': 'aa:bb:cc:dd:ee:ff', 'last_seen': None},
                           live_macs={'aa:bb:cc:dd:ee:ff'})
    assert result.is_online is True
from app.schemas.devices import DeviceItem

def test_parse_device_historical_cache_is_marked_offline():
    """
    Asegura que registros históricos de FortiOS con 'is_online: True' y 'online_interfaces: [...]'
    vistos hace horas o días NUNCA se clasifiquen como online si no tienen presencia en ARP/live_macs.
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
    assert parsed.is_online is False, "Un dispositivo visto hace 7 días sin presencia en ARP debe ser OFFLINE"


def test_parse_device_active_device_is_marked_online():
    """
    Asegura que un dispositivo con actividad reciente (dentro de la ventana de actividad)
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


def test_parse_device_in_live_macs_marked_online_even_if_idle():
    """
    Asegura que un dispositivo en reposo con presencia en live_macs
    se clasifique como ONLINE si está dentro de la ventana de actividad configurada.
    """
    now = time.time()
    idle_live_device = {
        "mac": "b2:0e:1e:7b:d5:ca",
        "ip": "15.40.5.64",
        "hostname": "S23-EN-REPOSO",
        "is_online": True,
        "online_interfaces": ["SSID-Meztli"],
        "last_seen": now - 1800,  # Visto hace 30 minutos (inactivo)
    }
    live_macs = {"b2:0e:1e:7b:d5:ca"}

    parsed = _parse_device(idle_live_device, current_time=now, active_window_seconds=3600, live_macs=live_macs)
    assert parsed.is_online is True, "Dispositivo presente en live_macs dentro de la ventana debe ser ONLINE"


def test_parse_device_missing_or_null_last_seen_is_offline():
    """
    Asegura que dispositivos sin last_seen o con timestamp 0 sean offline si no están en live_macs.
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


def test_parse_device_not_in_live_macs_is_strictly_offline():
    """
    Asegura que si live_macs está provisto (desde unified_latest), un dispositivo que NO esté
    en live_macs sea estrictamente OFFLINE, garantizando coincidencia 1:1 con el widget 'Assets'
    oficial de FortiGate.
    """
    now = time.time()
    device = {
        "mac": "cc:22:33:44:55:66",
        "ip": "10.0.0.99",
        "hostname": "TEST-DEV",
        "is_online": True,
        "last_seen": now - 30,  # Visto hace solo 30s
    }
    live_macs = {"aa:bb:cc:dd:ee:ff"}  # MAC diferente

    parsed = _parse_device(device, current_time=now, live_macs=live_macs)
    assert parsed.is_online is False, "Si live_macs está provisto y la MAC no está presente, debe ser OFFLINE"


def test_live_macs_exact_count_in_inventory():
    """
    Garantiza que en un inventario de 100 equipos, si live_macs contiene exactamente 35 MACs,
    el conteo de online_devices sea exactamente 35 y offline_devices sea exactamente 65.
    """
    now = time.time()
    raw_devices = [
        {"mac": f"00:11:22:33:44:{i:02x}", "last_seen": now - 50, "is_online": True}
        for i in range(100)
    ]
    # Solo 35 en live_macs
    live_macs = {f"00:11:22:33:44:{i:02x}" for i in range(35)}

    parsed_list = [_parse_device(d, current_time=now, live_macs=live_macs) for d in raw_devices]
    online = sum(1 for d in parsed_list if d.is_online)
    offline = sum(1 for d in parsed_list if not d.is_online)

    assert online == 35
    assert offline == 65
    assert online + offline == 100
