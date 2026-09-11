"""Five-minute aggregate samples, 30-day retention. Never persist source records."""
import json
import math
import threading
import time
from datetime import datetime, timezone
from dashboard_access import database

RETENTION_SECONDS = 30 * 86400
INTERVAL_SECONDS = 300
FIELDS = frozenset(("dhcp_capacity", "dhcp_leases", "cpu_percent", "memory_percent", "session_count", "infrastructure_devices"))


def save_sample(metrics, now=None):
    now = int(time.time() if now is None else now)
    values = {key: value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None for key, value in metrics.items() if key in FIELDS}
    with database(write=True) as db:
        db.execute("DELETE FROM metric_samples WHERE sampled_at<=?", (now - RETENTION_SECONDS,))
        db.execute("INSERT OR REPLACE INTO metric_samples VALUES (?,?)", (now, json.dumps(values)))


def history(now=None):
    now = int(time.time() if now is None else now)
    with database(write=True) as db:
        db.execute("DELETE FROM metric_samples WHERE sampled_at<=?", (now - RETENTION_SECONDS,))
        rows = db.execute("SELECT sampled_at,metrics FROM metric_samples ORDER BY sampled_at DESC LIMIT 8640").fetchall()
    return {"success": True, "data": {"items": [{"observed_at": datetime.fromtimestamp(row["sampled_at"], timezone.utc).isoformat(), **json.loads(row["metrics"])} for row in rows], "retention_days": 30, "interval_seconds": INTERVAL_SECONDS}}


def collect(fetch):
    def data(service, path):
        try:
            code, body, _ = fetch(service, path)
            value = json.loads(body)
            return value.get("data") if 200 <= code < 300 and isinstance(value, dict) and value.get("success") is not False and not value.get("error") else None
        except (ValueError, TypeError, OSError):
            return None
    pools = data("forti", "/network/dhcp-pools")
    resources = data("forti", "/system/resources")
    devices = data("omni", "/monitoring/devices")
    metrics = {"dhcp_capacity": (pools or {}).get("total_capacity"), "dhcp_leases": (pools or {}).get("total_active_leases"), "infrastructure_devices": len(devices) if isinstance(devices, list) else None}
    metrics.update({key: (resources or {}).get(key) for key in ("cpu_percent", "memory_percent", "session_count")})
    save_sample(metrics)


def start_collector(fetch):
    stop = threading.Event()
    def run():
        while not stop.is_set():
            try:
                collect(fetch)
            except Exception:
                # No provider bodies, credentials or records enter logs on failure.
                pass
            stop.wait(INTERVAL_SECONDS)
    thread = threading.Thread(target=run, name="sgrs-aggregate-metrics", daemon=True)
    thread.start()
    return stop
