import io
import json
import sys
import time
from pathlib import Path

forti_dir = str(Path(__file__).resolve().parent.parent / "API Forti")
if forti_dir not in sys.path:
    sys.path.insert(0, forti_dir)

import dashboard_access as access
from dashboard_device_history import (
    record_device_presence,
    get_longest_connected_devices,
    format_device_type,
)
import server
from app.routers.devices import _parse_device


def test_parse_device_extracts_enriched_fields_from_fortigate():
    raw_item = {
        "hostname": "04820300-B9QQ62",
        "mac": "a8:3c:a5:22:90:0d",
        "ip": "192.168.40.106",
        "interface": "DATA",
        "os_name": "Windows / 10",
        "unauthenticated_user": "ricardo.martinezal",
        "fortigate": "ISSSTE-TLAJOMULCOB",
        "serial_number": "SN-04820300",
        "last_seen": time.time(),
        "is_online": True,
    }

    parsed = _parse_device(raw_item)
    assert parsed.user == "ricardo.martinezal"
    assert parsed.serial == "SN-04820300"
    assert parsed.detected_device == "04820300-B9QQ62"
    assert parsed.fortigate == "ISSSTE-TLAJOMULCOB"
    assert parsed.hostname == "04820300-B9QQ62"
    assert parsed.ip == "192.168.40.106"
    assert parsed.mac == "a8:3c:a5:22:90:0d"
    assert parsed.interface == "DATA"


def test_parse_device_fallback_user_and_fortigate():
    raw_item = {
        "hostname": "04820300-B9QQ62",
        "mac": "a8:3c:a5:22:90:0d",
        "ip": "192.168.40.106",
        "user": "ricardo.martinezal",
        "vdom": "root",
        "last_seen": time.time(),
        "is_online": True,
    }

    parsed = _parse_device(raw_item, fortigate_name="ISSSTE-TLAJOMULCOB")
    assert parsed.user == "ricardo.martinezal"
    assert parsed.detected_device == "04820300-B9QQ62"
    assert parsed.fortigate in ("ISSSTE-TLAJOMULCOB", "root")


def test_record_device_presence_preserves_and_updates_serial_and_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    mac = "A8:3C:A5:22:90:0D"
    dev1 = {
        "mac": mac,
        "ip": "192.168.40.106",
        "hostname": "04820300-B9QQ62",
        "vendor": "Dell",
        "serial": "SN-DELL-900D",
        "is_online": True,
    }

    # First connection
    res1 = record_device_presence([dev1], now=1000)
    assert mac in res1
    assert res1[mac]["hostname"] == "04820300-B9QQ62"
    assert res1[mac]["ip"] == "192.168.40.106"
    assert res1[mac]["vendor"] == "Dell"
    assert res1[mac]["serial"] == "SN-DELL-900D"

    # Second pulse: serial omitted in sample -> preserved from previous record
    dev2 = {
        "mac": mac,
        "ip": "192.168.40.106",
        "hostname": "04820300-B9QQ62",
        "vendor": "Dell",
        "is_online": True,
    }
    res2 = record_device_presence([dev2], now=1100)
    assert res2[mac]["serial"] == "SN-DELL-900D"
    assert res2[mac]["current_session_seconds"] == 100

    # Third pulse: updated hostname and IP -> updated in database
    dev3 = {
        "mac": mac,
        "ip": "192.168.40.200",
        "hostname": "04820300-B9QQ62-UPDATED",
        "vendor": "Dell Inc",
        "serial": "SN-DELL-900D-NEW",
        "is_online": True,
    }
    res3 = record_device_presence([dev3], now=1200)
    assert res3[mac]["ip"] == "192.168.40.200"
    assert res3[mac]["hostname"] == "04820300-B9QQ62-UPDATED"
    assert res3[mac]["vendor"] == "Dell Inc"
    assert res3[mac]["serial"] == "SN-DELL-900D-NEW"


def test_server_api_devices_enriches_matched_fields_and_supports_filtering(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)

    forti_devices_payload = {
        "status": "success",
        "data": {
            "total_inventory": 2,
            "online_devices": 2,
            "offline_devices": 0,
            "returned_count": 2,
            "devices": [
                {
                    "mac": "a8:3c:a5:22:90:0d",
                    "ip": "192.168.40.106",
                    "hostname": "04820300-B9QQ62",
                    "detected_device": "04820300-B9QQ62",
                    "interface": "DATA",
                    "os_name": "Windows 10",
                    "user": "ricardo.martinezal",
                    "fortigate": "ISSSTE-TLAJOMULCOB",
                    "serial": "SN-04820300",
                    "device_type": "Computadora",
                    "is_online": True,
                    "last_seen": 1000,
                },
                {
                    "mac": "00:17:c8:12:34:56",
                    "ip": "192.168.40.150",
                    "hostname": "IMP-URGENCIAS",
                    "detected_device": "IMP-URGENCIAS",
                    "interface": "DATA",
                    "os_name": "",
                    "hardware_vendor": "Kyocera",
                    "hardware_family": "Printer",
                    "device_type": "Impresora",
                    "is_online": True,
                    "last_seen": 1000,
                },
            ],
        },
    }

    monkeypatch.setattr(
        server,
        "_fetch_upstream",
        lambda url, timeout=10.0: (200, json.dumps(forti_devices_payload).encode("utf-8"), "application/json"),
    )
    monkeypatch.setattr(server, "ensure_omni_cache_warm", lambda max_wait=1.5: None)
    monkeypatch.setattr(server, "get_omni_device_by_mac", lambda mac: None)

    class DummyHandler(server.Handler):
        def __init__(self, path):
            self.path = path
            self.identity = {
                "user": {"role": "soporte", "id": "sop-1"},
                "capabilities": access.capabilities("soporte"),
            }
            self.response = None
            self.raw_output = None
            self.headers_sent = {}

        def access_get(self):
            return False

        def _send_json(self, data, status=200):
            self.response = (status, data)

        def send_response(self, status):
            self._status = status

        def send_header(self, k, v):
            self.headers_sent[k] = v

        def end_headers(self):
            pass

        @property
        def wfile(self):
            class WFile:
                def __init__(outer):
                    outer.buf = io.BytesIO()
                def write(outer, b):
                    self.raw_output = b
            return WFile()

    # 1. Test regular devices query has all enriched fields
    h = DummyHandler("/api/devices")
    h.do_GET()
    status, devs = h.response
    assert status == 200
    assert len(devs) == 2

    pc = next(d for d in devs if d["mac"] == "a8:3c:a5:22:90:0d")
    assert pc["hostname"] == "04820300-B9QQ62"
    assert pc["user"] == "ricardo.martinezal"
    assert pc["serial"] == "SN-04820300"
    assert pc["detected_device"] == "04820300-B9QQ62"
    assert pc["fortigate"] == "ISSSTE-TLAJOMULCOB"
    assert pc["interface"] == "DATA"

    # 2. Test filtering by type: Computadora
    h_comp = DummyHandler("/api/devices?type=Computadora")
    h_comp.do_GET()
    _, comp_devs = h_comp.response
    assert len(comp_devs) == 1
    assert comp_devs[0]["mac"] == "a8:3c:a5:22:90:0d"

    # 3. Test filtering by type: Impresora
    h_print = DummyHandler("/api/devices?type=Impresora")
    h_print.do_GET()
    _, print_devs = h_print.response
    assert len(print_devs) == 1
    assert print_devs[0]["mac"] == "00:17:c8:12:34:56"

    # 4. Test CSV export of printers with 8 standard columns
    h_export = DummyHandler("/api/devices/export?type=impresora")
    h_export.do_GET()
    assert h_export.headers_sent.get("Content-Type") == "text/csv; charset=utf-8"
    assert "impresora.csv" in h_export.headers_sent.get("Content-Disposition", "")
    csv_text = h_export.raw_output.decode("utf-8")
    assert "Tipo de Dispositivo" in csv_text
    assert "Dirección IP" in csv_text
    assert "Dirección MAC" in csv_text
    assert "Nombre de Equipo / Hostname" in csv_text
    assert "Interfaz" in csv_text
    assert "Tiempo Conectado" in csv_text
    assert "Ubicación" in csv_text
    assert "Piso" in csv_text
    assert "IMP-URGENCIAS" in csv_text
    # Verify eliminated old columns are not in CSV
    assert "Número de Serie" not in csv_text
    assert "Sistema Operativo" not in csv_text
    assert "FortiGate" not in csv_text

    # 5. Test Excel export of printers
    h_excel = DummyHandler("/api/devices/export?type=impresora&format=excel")
    h_excel.do_GET()
    assert h_excel.headers_sent.get("Content-Type") == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert "impresora.xlsx" in h_excel.headers_sent.get("Content-Disposition", "")
    import zipfile
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(io.BytesIO(h_excel.raw_output)) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        assert workbook.find('s:sheets/s:sheet', ns).get('name') == 'Impresoras'
        sheet = archive.read('xl/worksheets/sheet1.xml').decode('utf-8')
        assert 'Nombre de Equipo / Hostname' in sheet
        assert 'IMP-URGENCIAS' in sheet


def test_server_dhcp_pools_saturation_metrics(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)

    pools_upstream_payload = {
        "success": True,
        "data": {
            "total_pools": 3,
            "total_capacity": 600,
            "total_active_leases": 360,
            "pools": [
                {
                    "id": 1,
                    "interface": "DATA-CRITICAL",
                    "capacity": 200,
                    "active_leases": 180,
                    "ip_ranges": ["192.168.40.1 - 192.168.40.200"],
                },
                {
                    "id": 2,
                    "interface": "DATA-WARNING",
                    "capacity": 200,
                    "active_leases": 120,
                    "ip_ranges": ["192.168.50.1 - 192.168.50.200"],
                },
                {
                    "id": 3,
                    "interface": "DATA-NORMAL",
                    "capacity": 200,
                    "active_leases": 60,
                    "ip_ranges": ["192.168.60.1 - 192.168.60.200"],
                },
            ],
        },
    }

    monkeypatch.setattr(
        server,
        "_fetch_upstream",
        lambda url, timeout=12.0: (200, json.dumps(pools_upstream_payload).encode("utf-8"), "application/json"),
    )

    class DummyHandler(server.Handler):
        def __init__(self, path):
            self.path = path
            self.identity = {
                "user": {"role": "soporte", "id": "sop-1"},
                "capabilities": access.capabilities("soporte"),
            }
            self.response = None

        def access_get(self):
            return False

        def _send_json(self, data, status=200):
            self.response = (status, data)

        def _send_raw(self, body, status=200, content_type="application/json"):
            self.response = (status, json.loads(body.decode("utf-8")))

    h = DummyHandler("/api/forti/network/dhcp-pools")
    h.do_GET()
    status, payload = h.response
    assert status == 200
    pools = payload["data"]["pools"]

    # Critical pool (90% >= 80%)
    p1 = next(p for p in pools if p["interface"] == "DATA-CRITICAL")
    assert p1["capacity"] == 200
    assert p1["active_leases"] == 180
    assert p1["available_ips"] == 20
    assert p1["utilization_percent"] == 90.0
    assert p1["saturation_status"] == "critical"

    # Warning pool (60% >= 50% and < 80%)
    p2 = next(p for p in pools if p["interface"] == "DATA-WARNING")
    assert p2["capacity"] == 200
    assert p2["active_leases"] == 120
    assert p2["available_ips"] == 80
    assert p2["utilization_percent"] == 60.0
    assert p2["saturation_status"] == "warning"

    # Normal pool (30% < 50%)
    p3 = next(p for p in pools if p["interface"] == "DATA-NORMAL")
    assert p3["capacity"] == 200
    assert p3["active_leases"] == 60
    assert p3["available_ips"] == 140
    assert p3["utilization_percent"] == 30.0
    assert p3["saturation_status"] == "normal"
