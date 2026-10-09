import json
import pytest
import dashboard_access as access
from dashboard_device_history import (
    normalize_mac,
    format_device_type,
    is_device_online,
    record_device_presence,
    get_longest_connected_devices,
    DEFAULT_TOLERANCE_SECONDS,
)
from dashboard_routes import AccessRoutes


def test_mac_normalization():
    assert normalize_mac("00:11:22:33:44:55") == "00:11:22:33:44:55"
    assert normalize_mac("aa-bb-cc-dd-ee-ff") == "AA:BB:CC:DD:EE:FF"
    assert normalize_mac("0011.2233.4455") == "00:11:22:33:44:55"
    assert normalize_mac("aabbccddeeff") == "AA:BB:CC:DD:EE:FF"
    assert normalize_mac("") == ""
    assert normalize_mac(None) == ""
    assert normalize_mac("—") == ""
    assert normalize_mac("invalid-mac") == ""


def test_format_device_type_heuristics():
    assert format_device_type("Dispositivo", "Windows 11", "PC-Office", "HP") == "Computadora"
    assert format_device_type("Dispositivo", "macOS", "MacBook-Air", "Apple") == "Computadora"
    assert format_device_type("Dispositivo", "Android 14", "POCO-X5", "Xiaomi") == "Teléfono"
    assert format_device_type("Dispositivo", "iOS", "iPhone-14-Pro", "Apple") == "Teléfono"
    assert format_device_type("Dispositivo", "iPadOS", "iPad-Mini", "Apple") == "Teléfono"
    assert format_device_type("Unknown", "DESKTOP-4PD9M80", "Fortinet") == "Computadora"
    assert format_device_type("Unknown", "POCO-M5s", "Xiaomi") == "Teléfono"
    assert format_device_type("Unknown", "KM0679C0", "Kyocera") == "Impresora"
    assert format_device_type("Computadora") == "Computadora"
    assert format_device_type("Teléfono") == "Teléfono"
    assert format_device_type("Impresora") == "Impresora"
    assert format_device_type("Móvil") == "Teléfono"

    # Dict input
    assert format_device_type({"os": "Windows 10", "name": "Workstation", "vendor": "Lenovo"}) == "Computadora"
    assert format_device_type({"raw": {"os_name": "macOS"}, "name": "MacBook", "vendor": "Apple"}) == "Computadora"
    assert format_device_type({"os": "Android", "name": "Redmi-Note", "vendor": "Xiaomi"}) == "Teléfono"


def test_is_device_online():
    assert is_device_online({"is_online": True}) is True
    assert is_device_online({"status": "online"}) is True
    assert is_device_online({"status": "Up"}) is True
    assert is_device_online({"raw": {"is_online": 1}}) is True
    assert is_device_online({"omnivista": {"status": "Up"}}) is True
    assert is_device_online({"status": "offline"}) is False
    assert is_device_online({"is_online": False}) is False
    assert is_device_online({}) is False
    assert is_device_online(None) is False


def test_device_presence_new_device(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    now = 1000

    devices = [
        {
            "mac": "00:11:22:33:44:55",
            "ip": "192.168.1.50",
            "name": "PC-FINANZAS",
            "os": "Windows 11 Pro",
            "vendor": "Dell",
            "status": "online",
        }
    ]

    res = record_device_presence(devices, now=now)
    mac = "00:11:22:33:44:55"
    assert mac in res
    entry = res[mac]
    assert entry["mac"] == mac
    assert entry["ip"] == "192.168.1.50"
    assert entry["hostname"] == "PC-FINANZAS"
    assert entry["device_type"] == "Computadora"
    assert entry["vendor"] == "Dell"
    assert entry["first_connected_at"] == now
    assert entry["last_seen_at"] == now
    assert entry["current_session_seconds"] == 0
    assert entry["total_connected_seconds"] == 0
    assert entry["is_online"] == 1


def test_device_presence_continuous_connection_accumulation(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {
        "mac": mac,
        "ip": "192.168.1.50",
        "name": "PC-CONTABILIDAD",
        "os": "Windows 11",
        "vendor": "HP",
        "status": "online",
    }

    # Pulse 1: initial connection
    record_device_presence([dev], now=1000)

    # Pulse 2: 60 seconds later
    res2 = record_device_presence([dev], now=1060)
    assert res2[mac]["current_session_seconds"] == 60
    assert res2[mac]["total_connected_seconds"] == 60
    assert res2[mac]["last_seen_at"] == 1060
    assert res2[mac]["first_connected_at"] == 1000
    assert res2[mac]["is_online"] == 1

    # Pulse 3: 120 seconds later (total 180s from start)
    res3 = record_device_presence([dev], now=1180)
    assert res3[mac]["current_session_seconds"] == 180
    assert res3[mac]["total_connected_seconds"] == 180
    assert res3[mac]["last_seen_at"] == 1180


def test_device_presence_outage_bounding(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {"mac": mac, "ip": "10.0.0.5", "name": "PC-SERVER", "os": "Windows Server", "is_online": True}

    # Pulse 1
    record_device_presence([dev], now=1000)

    # Long outage gap (e.g. 10000 seconds later)
    res = record_device_presence([dev], now=11000)
    # A stale online sample cannot prove the device stayed connected during the outage.
    assert res[mac]["current_session_seconds"] == 0
    assert res[mac]["total_connected_seconds"] == 0
    assert res[mac]["last_seen_at"] == 11000


def test_device_presence_stale_online_record_starts_new_session_after_gap(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {"mac": mac, "ip": "10.0.0.5", "name": "PC-STALE", "os": "Windows 11", "is_online": True}

    record_device_presence([dev], now=1000)
    record_device_presence([dev], now=1060)

    # A later online sample cannot prove the device stayed connected during the gap.
    res = record_device_presence([dev], now=1060 + DEFAULT_TOLERANCE_SECONDS + 1)

    assert res[mac]["first_connected_at"] == 1060 + DEFAULT_TOLERANCE_SECONDS + 1
    assert res[mac]["current_session_seconds"] == 0
    assert res[mac]["total_connected_seconds"] == 60
    assert res[mac]["last_seen_at"] == 1060 + DEFAULT_TOLERANCE_SECONDS + 1


def test_device_presence_restart_preserves_recent_session(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {"mac": mac, "ip": "10.0.0.5", "os": "Windows 11", "is_online": True}
    record_device_presence([dev], now=1000)
    record_device_presence([dev], now=1060)
    # Reopening persistent storage must not reset a recent session.
    res = record_device_presence([dev], now=1100)
    assert res[mac]["first_connected_at"] == 1000
    assert res[mac]["current_session_seconds"] == 100
    assert res[mac]["total_connected_seconds"] == 100


def test_device_presence_tolerance_and_offline_marking(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {"mac": mac, "ip": "192.168.1.50", "name": "PC-SOPORTE", "os": "Windows 10", "is_online": True}

    # Connect at t=1000
    record_device_presence([dev], now=1000)
    # At t=1060
    record_device_presence([dev], now=1060)

    # At t=1400 (340s after last seen, tolerance = 600s) - device is not in sample
    res_within_tol = record_device_presence([], now=1400, tolerance=600)
    # Still within tolerance grace period
    assert res_within_tol[mac]["is_online"] == 1

    # At t=1700 (640s after last seen, >= tolerance 600s) - device still not in sample
    res_offline = record_device_presence([], now=1700, tolerance=600)
    # Should now be marked offline
    assert res_offline[mac]["is_online"] == 0
    assert res_offline[mac]["current_session_seconds"] == 0
    assert res_offline[mac]["total_connected_seconds"] == 60


def test_device_presence_reconnection_after_offline(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "00:11:22:33:44:55"
    dev = {"mac": mac, "ip": "192.168.1.50", "name": "PC-RRHH", "os": "Windows 11", "is_online": True}

    # Connect and stay online for 100s
    record_device_presence([dev], now=1000)
    record_device_presence([dev], now=1100)

    # Exceed tolerance window and get marked offline
    record_device_presence([], now=2000, tolerance=600)
    with access.database() as db:
        row = db.execute("SELECT * FROM device_connection_history WHERE mac = ?", (mac,)).fetchone()
        assert row["is_online"] == 0
        assert row["total_connected_seconds"] == 100

    # Device reconnects at t=3000
    res_reconnect = record_device_presence([dev], now=3000)
    entry = res_reconnect[mac]
    assert entry["is_online"] == 1
    assert entry["first_connected_at"] == 3000
    assert entry["last_seen_at"] == 3000
    assert entry["current_session_seconds"] == 0
    # Cumulative total time was preserved!
    assert entry["total_connected_seconds"] == 100

    # Next pulse at t=3050 (50s later)
    res_pulse = record_device_presence([dev], now=3050)
    assert res_pulse[mac]["current_session_seconds"] == 50
    assert res_pulse[mac]["total_connected_seconds"] == 150


def test_get_longest_connected_devices_ordering_and_filters(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)

    # Populate 3 computers with different connection times and 1 phone
    pc1 = {"mac": "AA:00:00:00:00:01", "name": "PC-LONG", "os": "Windows 11", "is_online": True}
    pc2 = {"mac": "AA:00:00:00:00:02", "name": "PC-SHORT", "os": "Windows 10", "is_online": True}
    pc3 = {"mac": "AA:00:00:00:00:03", "name": "PC-MEDIUM", "os": "macOS", "is_online": True}
    phone = {"mac": "AA:00:00:00:00:04", "name": "Galaxy-S23", "os": "Android 14", "is_online": True}

    # Pulse at t=1000: all connect
    record_device_presence([pc1, pc2, pc3, phone], now=1000)

    # Pulse at t=1200: pc1 and pc3
    record_device_presence([pc1, pc3], now=1200)

    # Pulse at t=1500: pc1 only
    record_device_presence([pc1], now=1500)

    # Query longest connected computers
    longest = get_longest_connected_devices(device_type="Computadora", limit=10)
    assert len(longest) == 3
    # Ordered descending by continuous connection
    assert longest[0]["mac"] == "AA:00:00:00:00:01"
    assert longest[0]["current_session_seconds"] == 500
    assert longest[0]["hostname"] == "PC-LONG"

    assert longest[1]["mac"] == "AA:00:00:00:00:03"
    assert longest[1]["current_session_seconds"] == 200
    assert longest[1]["hostname"] == "PC-MEDIUM"

    assert longest[2]["mac"] == "AA:00:00:00:00:02"
    assert longest[2]["current_session_seconds"] == 0
    assert longest[2]["hostname"] == "PC-SHORT"

    # All expected fields present
    for dev in longest:
        for field in ("mac", "ip", "hostname", "device_type", "vendor",
                      "first_connected_at", "last_seen_at",
                      "current_session_seconds", "total_connected_seconds", "is_online"):
            assert field in dev

    # Query with type='all' includes phone
    all_devs = get_longest_connected_devices(device_type="all", limit=10)
    assert any(d["device_type"] == "Teléfono" for d in all_devs)


def test_support_longest_connected_endpoint_permissions(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)

    # Create dummy boundary handler
    class Boundary(AccessRoutes):
        def _origins(self):
            return {"http://localhost:3000"}

        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            pass

        def _send_json(self, payload, status=200):
            self.response = (status, payload)

    # Pre-populate a device
    dev = {"mac": "AA:BB:CC:DD:EE:01", "name": "PC-TEST", "os": "Windows 11", "is_online": True}
    record_device_presence([dev], now=1000)

    # 1. Role 'viewer' is denied (403)
    h_viewer = Boundary()
    h_viewer.path = "/api/support/longest-connected"
    h_viewer.identity = {"user": {"role": "viewer", "id": "v-1"}, "capabilities": access.capabilities("viewer")}
    assert h_viewer.access_get() is True
    code, payload = h_viewer.response
    assert code == 403
    assert "permiso" in payload["error"].lower()

    # 2. Role 'soporte' is allowed (200)
    h_soporte = Boundary()
    h_soporte.path = "/api/support/longest-connected?type=Computadora&limit=5"
    h_soporte.identity = {"user": {"role": "soporte", "id": "s-1"}, "capabilities": access.capabilities("soporte")}
    assert h_soporte.access_get() is True
    code, payload = h_soporte.response
    assert code == 200
    assert isinstance(payload, list)
    assert len(payload) == 1
    assert payload[0]["mac"] == "AA:BB:CC:DD:EE:01"

    # 3. Role 'admin' is allowed (200)
    h_admin = Boundary()
    h_admin.path = "/api/support/longest-connected"
    h_admin.identity = {"user": {"role": "admin", "id": "a-1"}, "capabilities": access.capabilities("admin")}
    assert h_admin.access_get() is True
    code, payload = h_admin.response
    assert code == 200
    assert isinstance(payload, list)

    # 4. Role 'super-admin' is allowed (200)
    h_super = Boundary()
    h_super.path = "/api/support/longest-connected"
    h_super.identity = {"user": {"role": "super-admin", "id": "sa-1"}, "capabilities": access.capabilities("super-admin")}
    assert h_super.access_get() is True
    code, payload = h_super.response
    assert code == 200
    assert isinstance(payload, list)


def test_schema_and_index_created(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    with access.database() as db:
        # Check table columns
        cols = {r["name"]: r["type"] for r in db.execute("PRAGMA table_info(device_connection_history)").fetchall()}
        expected_cols = {
            "mac": "TEXT",
            "ip": "TEXT",
            "hostname": "TEXT",
            "device_type": "TEXT",
            "vendor": "TEXT",
            "first_connected_at": "INTEGER",
            "last_seen_at": "INTEGER",
            "current_session_seconds": "INTEGER",
            "total_connected_seconds": "INTEGER",
            "is_online": "INTEGER",
            "updated_at": "INTEGER",
        }
        for name, col_type in expected_cols.items():
            assert name in cols
            assert cols[name] == col_type

        # Check index
        indices = [r["name"] for r in db.execute("PRAGMA index_list(device_connection_history)").fetchall()]
        assert "idx_device_history_type_streak" in indices


def test_server_api_devices_attaches_uptime_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    import server

    forti_response = {
        "status": "success",
        "data": {
            "total_inventory": 1,
            "online_devices": 1,
            "offline_devices": 0,
            "returned_count": 1,
            "devices": [
                {
                    "mac": "00:11:22:33:44:55",
                    "ip": "192.168.1.100",
                    "hostname": "PC-TEST-UPTIME",
                    "device_type": "Computadora",
                    "is_online": True,
                    "last_seen": 1000,
                }
            ],
        },
    }

    monkeypatch.setattr(
        server,
        "_fetch_upstream",
        lambda url, timeout=10.0: (200, json.dumps(forti_response).encode("utf-8"), "application/json"),
    )
    monkeypatch.setattr(server, "ensure_omni_cache_warm", lambda max_wait=1.5: None)
    monkeypatch.setattr(server, "get_omni_device_by_mac", lambda mac: None)

    class DummyHandler(server.Handler):
        def __init__(self):
            self.path = "/api/devices"
            self.identity = {
                "user": {"role": "soporte", "id": "sop-1"},
                "capabilities": access.capabilities("soporte"),
            }
            self.response = None

        def access_get(self):
            return False

        def _send_json(self, data, status=200):
            self.response = (status, data)

    record_device_presence(forti_response["data"]["devices"], now=1000)
    record_device_presence(forti_response["data"]["devices"], now=1060)
    h = DummyHandler()
    h.do_GET()

    status, devices = h.response
    assert status == 200
    assert len(devices) == 1
    dev = devices[0]
    assert dev["mac"] == "00:11:22:33:44:55"
    assert "uptime_seconds" in dev
    assert "first_connected_at" in dev
    assert "total_connected_seconds" in dev
    assert dev["uptime_seconds"] == 60
    assert dev["total_connected_seconds"] == 60
    assert dev["first_connected_at"] == 1000

    with access.database() as db:
        row = db.execute("SELECT * FROM device_connection_history WHERE mac = '00:11:22:33:44:55'").fetchone()
        assert row is not None
        assert row["last_seen_at"] == 1060  # Reading the API must not record a pulse.
        assert row["hostname"] == "PC-TEST-UPTIME"
        assert row["is_online"] == 1
