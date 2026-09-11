"""Read-only live diagnostics. Prints shapes/status, never credentials or records.

Uses configured gateway connections when present; otherwise each local API's
existing APP_API_KEY. Does not create users, enroll MFA or change remote devices.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import dotenv_values
from server import _configured_request

PATHS = {
    "forti": ["/health", "/devices", "/network/dhcp-pools", "/network/dhcp-leases", "/network/arp-table", "/network/interfaces", "/system/status", "/system/resources", "/system/firmware", "/firewall/policies", "/firewall/addresses", "/firewall/address-groups", "/traffic/sessions?limit=5", "/traffic/destinations?limit=5", "/traffic/logs?limit=5", "/vpn/ipsec", "/vpn/ssl-sessions"],
    "omni": ["/system/health", "/system/version", "/employees?page_size=5", "/company-properties?page_size=5", "/catalogs/access-role-profiles", "/catalogs/device-options", "/catalogs/vlans", "/monitoring/infrastructure-stats", "/monitoring/devices", "/monitoring/online-devices", "/monitoring/topology", "/monitoring/notifications"],
}


def config(name):
    path = ROOT / ".sgrs-private/dashboard.sqlite3"
    if path.exists():
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM connections WHERE id=?", (name,)).fetchone()
            if row:
                return dict(row)
    values = dotenv_values(ROOT / ("API Forti" if name == "forti" else "API Omni") / ".env")
    key = os.environ.get(f"{name.upper()}_API_KEY") or values.get("APP_API_KEY") or values.get("API_SECRET_KEY") or ""
    return {"url": os.environ.get(f"{name.upper()}_API_URL", f"http://127.0.0.1:{8001 if name == 'forti' else 8000}/api/v1"), "auth_mode": "api-key", "username": "", "secret": key}


def describe(value):
    result = {"type": type(value).__name__}
    if isinstance(value, dict):
        result["fields"] = sorted(value.keys())[:60]
        result["collections"] = {k: describe(v) for k, v in value.items() if isinstance(v, list)}
    elif isinstance(value, list):
        result["count"] = len(value)
        if value and isinstance(value[0], dict):
            result["item_fields"] = sorted(value[0].keys())[:60]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--provider-shapes", action="store_true", help="Read selected OmniVista response schemas; never print records")
    args = parser.parse_args()
    if args.provider_shapes:
        sys.path.insert(0, str(ROOT / "API Omni"))
        from app.services.omnivista_service import omnivista_service
        for endpoint in ("/api/vlan", "/api/topology/devices", "/api/notifications", "/api/system/version"):
            response = omnivista_service.request("GET", endpoint, timeout=20)
            try:
                shape = describe(response.json())
            except ValueError:
                shape = {"type": "non-json"}
            print(json.dumps({"path": endpoint, "http": response.status_code, "shape": shape}), flush=True)
        for endpoint in ("/api/ham/userAccount/getPageAllAccountList", "/api/ham/enterpriseProperty/getAllPageEnterprisePropertyInfo"):
            response = omnivista_service.request("POST", endpoint, json={"start": "", "querySize": 2, "queryBy": "Account"}, timeout=20)
            try:
                data = response.json()
                shape = describe(data)
                shape["counts"] = {key: value for key, value in data.items() if key.lower() in ("total", "totalcount", "count", "hasmore") and isinstance(value, (int, bool))}
            except ValueError:
                shape = {"type": "non-json"}
            print(json.dumps({"path": endpoint, "http": response.status_code, "shape": shape}), flush=True)
        return 0
    failed = False
    for name, paths in PATHS.items():
        configuration = config(name)
        for path in paths if args.all else paths[:1]:
            started = time.monotonic()
            code, body, _ = _configured_request(configuration, path, timeout=30)
            try:
                payload = json.loads(body)
            except ValueError:
                payload = {}
            record = {"service": name, "path": path, "http": code, "elapsed_ms": round((time.monotonic()-started)*1000), "success": payload.get("success")}
            data = payload.get("data")
            record["shape"] = describe(data)
            if path == "/health" and isinstance(data, dict):
                record["upstream_connected"] = data.get("fortigate_connection", {}).get("reachable")
            if path == "/system/health" and isinstance(data, dict):
                record["upstream_connected"] = data.get("omnivista_connected")
            failed |= not (200 <= code < 300) or payload.get("success") is False or record.get("upstream_connected") is False
            print(json.dumps(record), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
