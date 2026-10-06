"""Health is confirmed by the equipment, not merely by the API's HTTP status."""
import json


def upstream_healthy(service, code, payload):
    if not 200 <= code < 300:
        return False
    try:
        value = json.loads(payload)
    except (ValueError, TypeError, UnicodeError):
        return False
    if not isinstance(value, dict) or value.get("success") is False or value.get("error"):
        return False
    data = value.get("data")
    if not isinstance(data, dict):
        return False
    if service == "forti":
        connection = data.get("fortigate_connection")
        return isinstance(connection, dict) and connection.get("reachable") is True
    if service == "inventarios":
        return data.get('storage_connected') is True
    return service == "omni" and data.get("omnivista_connected") is True
