"""End-to-end GET verification with an isolated, disposable account database.

Never creates operational accounts or changes equipment. Real credentials remain
in memory and diagnostics print only HTTP status, resource id and schema checks.
"""
import http.client
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from check_integrations import config
import dashboard_access as access
from dashboard_catalog import CATALOG
from dashboard_history import collect
import server


def main():
    configurations = {name: config(name) for name in ("forti", "omni")}
    original_private = access.PRIVATE
    original_connection = server.connection
    failed = []
    unavailable = []
    class QuietHandler(server.Handler):
        def log_message(self, *args):
            pass
    with tempfile.TemporaryDirectory(prefix="sgrs-live-check-") as directory:
        access.PRIVATE = Path(directory)
        server.connection = lambda name: configurations[name]
        password = secrets.token_urlsafe(24)
        root = access.save_user({"username": "verify.local", "name": "Prueba aislada", "role": "super-admin", "password": password}, bootstrap=True)
        token, _ = access.login({"username": "verify.local", "password": password}, "127.0.0.1")
        httpd = server.ThreadedHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        def get(path, cookie=token):
            client = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=30)
            try:
                client.request("GET", path, headers={"Host": "127.0.0.1:3000", "Cookie": f"sgrs_session={cookie}"})
                response = client.getresponse()
                return response.status, json.loads(response.read())
            finally:
                client.close()
        try:
            collect(lambda name, path: server._configured_request(configurations[name], path, timeout=20))
            for module in CATALOG:
                for resource in module["resources"]:
                    status, payload = get(resource["path"])
                    if status != 200:
                        unavailable.append(resource["id"])
                        print(json.dumps({"resource": resource["id"], "http": status, "available": False}), flush=True)
                        continue
                    data = payload.get("data")
                    rows = data.get(resource["collection"]) if resource["collection"] and isinstance(data, dict) else data
                    valid = isinstance(rows, (dict, list)) and payload.get("success") is not False
                    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                        valid &= all(column["key"] in rows[0] for column in resource["columns"])
                    if not valid:
                        failed.append(resource["id"])
                    print(json.dumps({"resource": resource["id"], "http": status, "schema_valid": valid, "received": len(rows) if isinstance(rows, list) else None}), flush=True)
            for role in ("admin", "viewer"):
                access.save_user({"username": f"{role}.verify", "name": "Prueba aislada", "role": role, "password": password}, root["id"])
                cookie, identity = access.login({"username": f"{role}.verify", "password": password}, "127.0.0.1")
                assert all(item["id"] != "super-admin" for item in identity["roles"])
                for path in ("/api/admin/catalog", "/api/admin/history", "/api/admin/users", "/api/admin/connections", "/api/omni/employees", "/api/forti/firewall/policies"):
                    status, payload = get(path, cookie)
                    assert status == 403 and "super" not in json.dumps(payload).lower()
            print(json.dumps({"schema_failures": failed, "unavailable_resources": unavailable, "business_permissions": "passed", "operational_accounts_modified": False}), flush=True)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
            access.PRIVATE = original_private
            server.connection = original_connection
    return 1 if failed or unavailable else 0


if __name__ == "__main__":
    raise SystemExit(main())
