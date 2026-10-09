"""Device connection history and observed connection time for SGRS Support Dashboard.

Persists observed sessions and cumulative connection history in SQLite.
The server collector owns presence updates independently of user sessions.
"""
import re
import time
from dashboard_access import database

# Default tolerance window before marking an inactive device as offline (in seconds)
DEFAULT_TOLERANCE_SECONDS = 600

# Maximum single-step delta to avoid inflating connection duration during power outages/gaps
MAX_STEP_SECONDS = 900


def normalize_mac(raw_mac):
    """Normalize MAC address to uppercase colon-separated format XX:XX:XX:XX:XX:XX.
    
    Returns empty string if the MAC cannot be parsed into 12 hexadecimal characters.
    """
    if not raw_mac:
        return ""
    clean = "".join(c for c in str(raw_mac).upper() if c in "0123456789ABCDEF")
    if len(clean) == 12:
        return ":".join(clean[i:i + 2] for i in range(0, 12, 2))
    return ""


def format_device_type(type_val="", os_val="", name_val="", vendor_val=""):
    """Classify device into 'Computadora', 'Teléfono', 'Impresora', etc.
    
    Accepts either individual string arguments or a dictionary object representing a device.
    Follows the domain heuristic contract matching the SGRS dashboard.
    """
    t = ""
    o = ""
    n = ""
    v = ""

    if isinstance(type_val, dict):
        dev = type_val
        t = dev.get("device_type") or dev.get("type") or ""
        raw = dev.get("raw") if isinstance(dev.get("raw"), dict) else {}
        ov = dev.get("omnivista") if isinstance(dev.get("omnivista"), dict) else {}
        o = dev.get("os") or dev.get("os_name") or raw.get("os_name") or ov.get("os") or ""
        n = dev.get("name") or dev.get("hostname") or ov.get("device_name") or ""
        v = dev.get("vendor") or dev.get("hardware_vendor") or ov.get("family") or ""
    else:
        t = str(type_val or "")
        if vendor_val != "":
            o = str(os_val or "")
            n = str(name_val or "")
            v = str(vendor_val or "")
        elif name_val != "":
            test_os = str(os_val or "").lower()
            if re.search(r"(windows|macos|mac_os|mac\s*os|os\s*x|android|ios|iphone|ipad|ipados|linux)", test_os):
                o = str(os_val or "")
                n = str(name_val or "")
            else:
                n = str(os_val or "")
                v = str(name_val or "")
        else:
            test_os = str(os_val or "").lower()
            if re.search(r"(windows|macos|mac_os|mac\s*os|os\s*x|android|ios|iphone|ipad|ipados|linux)", test_os):
                o = str(os_val or "")
            else:
                n = str(os_val or "")

    t = t.strip()
    o = o.strip()
    n = n.strip()
    v = v.strip()

    os_lower = o.lower()
    if re.search(r"(windows|macos|mac_os|mac\s*os|os\s*x)", os_lower):
        return "Computadora"
    if re.search(r"(android|ios|iphone|ipad|ipados)", os_lower):
        return "Teléfono"

    if t in ("Computadora", "Teléfono", "Impresora"):
        return t
    if t.lower() in ("móvil", "movil"):
        return "Teléfono"

    combined = f"{t} {o} {n} {v}".lower()
    if re.search(r"(phone|iphone|android|movil|móvil|celular|ipad|tablet|poco|redmi|xiaomi|samsung|huawei|motorola|oppo|vivo|realme|galaxy)", combined):
        return "Teléfono"
    if re.search(r"(desktop|laptop|pc|macbook|imac|thinkpad|workstation|dell|lenovo|hp|computer)", combined):
        return "Computadora"
    if re.search(r"(printer|impresora|kyocera|ricoh|epson)", combined):
        return "Impresora"

    if not t or t.lower() in ("unknown", "dispositivo"):
        return "Desconocido"
    return t


def format_uptime(seconds):
    """Format connection duration in seconds into human-readable duration (e.g. '< 1m', '45m', '5h 23m', '3d 14h')."""
    if seconds is None:
        return "—"
    try:
        sec = max(0, int(float(seconds)))
    except (ValueError, TypeError):
        return "—"
    if sec < 60:
        return "< 1m"
    if sec < 3600:
        mins = sec // 60
        return f"{mins}m"
    if sec < 86400:
        hours = sec // 3600
        mins = (sec % 3600) // 60
        return f"{hours}h {mins}m"
    days = sec // 86400
    hours = (sec % 86400) // 3600
    return f"{days}d {hours}h"


def is_device_online(dev):
    """Determine whether a device is active/online from FortiGate or OmniVista metadata."""
    if not isinstance(dev, dict):
        return False
    if dev.get("is_online") is True or dev.get("is_online") == 1:
        return True
    st = str(dev.get("status") or "").strip().lower()
    if st in ("online", "up", "connected", "activo"):
        return True

    raw = dev.get("raw")
    if isinstance(raw, dict):
        if raw.get("is_online") is True or raw.get("is_online") == 1:
            return True
        raw_st = str(raw.get("status") or "").strip().lower()
        if raw_st in ("online", "up", "connected"):
            return True

    ov = dev.get("omnivista")
    if isinstance(ov, dict):
        if ov.get("is_online") is True or ov.get("is_online") == 1:
            return True
        ov_st = str(ov.get("status") or "").strip().lower()
        if ov_st in ("online", "up", "connected"):
            return True

    return False


def record_device_presence(devices, now=None, tolerance=DEFAULT_TOLERANCE_SECONDS):
    """Record and update presence pulse, continuous uptime, and cumulative connection time.

    - Normalizes MAC addresses.
    - If device was already online and observed within `tolerance`:
      - Increments current_session_seconds and total_connected_seconds by (now - last_seen_at)
        capped at MAX_STEP_SECONDS.
      - Updates last_seen_at = now, ip, hostname, vendor.
    - If device is new or was offline and reconnects:
      - Sets is_online = 1, first_connected_at = now, last_seen_at = now, current_session_seconds = 0.
    - If registered devices have not been seen for at least `tolerance` seconds:
      - Sets is_online = 0, current_session_seconds = 0.

    Returns a dict mapping normalized MAC to device record dict.
    """
    now = int(time.time() if now is None else now)
    tolerance = int(tolerance if tolerance is not None else DEFAULT_TOLERANCE_SECONDS)

    if not isinstance(devices, (list, tuple)):
        devices = []

    # Aggregate incoming devices by normalized MAC
    incoming_by_mac = {}
    for dev in devices:
        if not isinstance(dev, dict):
            continue
        raw_mac = dev.get("mac") or dev.get("deviceMac")
        if not raw_mac and isinstance(dev.get("raw"), dict):
            raw_mac = dev["raw"].get("mac")
        clean_mac = normalize_mac(raw_mac)
        if not clean_mac:
            continue

        online = is_device_online(dev)
        if clean_mac in incoming_by_mac:
            prev_dev, prev_online = incoming_by_mac[clean_mac]
            # If any sample for this MAC is online, mark online and pick non-empty fields
            if online and not prev_online:
                incoming_by_mac[clean_mac] = (dev, True)
            else:
                # Merge fields if missing
                merged = dict(prev_dev)
                for k, v in dev.items():
                    if v and not merged.get(k):
                        merged[k] = v
                incoming_by_mac[clean_mac] = (merged, prev_online or online)
        else:
            incoming_by_mac[clean_mac] = (dev, online)

    with database(write=True) as db:
        # Load existing tracked records
        rows = db.execute("SELECT * FROM device_connection_history").fetchall()
        existing = {r["mac"]: dict(r) for r in rows}

        for clean_mac, (dev, online) in incoming_by_mac.items():
            if not online:
                continue

            raw = dev.get("raw") if isinstance(dev.get("raw"), dict) else {}
            ov = dev.get("omnivista") if isinstance(dev.get("omnivista"), dict) else {}

            ip = str(dev.get("ip") or dev.get("ipAddress") or raw.get("ip") or "—").strip()
            hostname = str(dev.get("name") or dev.get("hostname") or dev.get("deviceName") or raw.get("hostname") or ov.get("device_name") or "").strip()
            vendor = str(dev.get("vendor") or dev.get("hardware_vendor") or raw.get("hardware_vendor") or ov.get("family") or "").strip()
            prev = existing.get(clean_mac)
            prev_serial = str(prev.get("serial") or "").strip() if prev and prev.get("serial") != "—" else ""

            explicit_serial = str(
                dev.get("serial")
                or dev.get("serial_number")
                or dev.get("hardware_serial")
                or raw.get("serial")
                or raw.get("serial_number")
                or raw.get("hardware_serial")
                or ov.get("serialNumber")
                or ""
            ).strip()

            if explicit_serial and explicit_serial != "—":
                serial = explicit_serial
            elif prev_serial:
                serial = prev_serial
            elif hostname and ("-" in hostname or len(hostname) >= 6):
                serial = hostname
            else:
                serial = "—"

            dtype = format_device_type(dev)
            if not dtype or dtype == "Desconocido":
                dtype = str(dev.get("device_type") or dev.get("type") or "Computadora").strip()
                if dtype in ("Desconocido", "Dispositivo", ""):
                    dtype = "Computadora"

            if prev is None:
                # New device connected
                db.execute("""
                    INSERT INTO device_connection_history (
                        mac, ip, hostname, device_type, vendor, serial,
                        first_connected_at, last_seen_at,
                        current_session_seconds, total_connected_seconds,
                        is_online, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    clean_mac, ip, hostname, dtype, vendor, serial,
                    now, now, 0, 0, 1, now
                ))
            else:
                target_serial = serial or prev_serial or "—"
                target_ip = ip if ip != "—" else prev["ip"]
                target_hostname = hostname or prev["hostname"]
                target_vendor = vendor or prev["vendor"]

                gap_seconds = max(0, now - int(prev["last_seen_at"]))
                if prev["is_online"] == 1 and gap_seconds <= tolerance:
                    # Equipment was observed recently: increment session & total.
                    raw_delta = max(0, now - prev["last_seen_at"])
                    delta = min(raw_delta, MAX_STEP_SECONDS)
                    current_session = prev["current_session_seconds"] + delta
                    total_connected = prev["total_connected_seconds"] + delta
                    db.execute("""
                        UPDATE device_connection_history
                        SET ip = ?, hostname = ?, device_type = ?, vendor = ?, serial = ?,
                            last_seen_at = ?, current_session_seconds = ?,
                            total_connected_seconds = ?, is_online = 1, updated_at = ?
                        WHERE mac = ?
                    """, (
                        target_ip,
                        target_hostname,
                        dtype or prev["device_type"],
                        target_vendor,
                        target_serial,
                        now, current_session, total_connected, now, clean_mac
                    ))
                else:
                    # Equipment was offline or stale and just reconnected: start fresh session.
                    db.execute("""
                        UPDATE device_connection_history
                        SET ip = ?, hostname = ?, device_type = ?, vendor = ?, serial = ?,
                            first_connected_at = ?, last_seen_at = ?,
                            current_session_seconds = 0, is_online = 1, updated_at = ?
                        WHERE mac = ?
                    """, (
                        target_ip,
                        target_hostname,
                        dtype or prev["device_type"],
                        target_vendor,
                        target_serial,
                        now, now, now, clean_mac
                    ))

        # Mark devices offline if not seen for at least tolerance seconds
        cutoff = now - tolerance
        db.execute("""
            UPDATE device_connection_history
            SET is_online = 0, current_session_seconds = 0, updated_at = ?
            WHERE is_online = 1 AND last_seen_at <= ?
        """, (now, cutoff))

        # Return updated snapshot
        all_rows = db.execute("SELECT * FROM device_connection_history").fetchall()
        return {r["mac"]: dict(r) for r in all_rows}


def get_longest_connected_devices(device_type="Computadora", limit=50, is_online=None, only_online=False):
    """Retrieve tracked devices ordered by continuous session connection time.

    Returns list of dicts with:
    mac, ip, hostname, device_type, vendor, first_connected_at, last_seen_at,
    current_session_seconds, total_connected_seconds, is_online.
    """
    try:
        limit_val = int(limit)
        if limit_val <= 0:
            limit_val = 50
        elif limit_val > 500:
            limit_val = 500
    except (ValueError, TypeError):
        limit_val = 50

    with database() as db:
        conditions = []
        params = []

        if device_type and str(device_type).strip().lower() not in ("all", "*", "todos"):
            conditions.append("LOWER(device_type) = LOWER(?)")
            params.append(str(device_type).strip())

        if only_online or is_online is not None:
            online_val = 1 if (is_online is True or is_online == 1 or only_online) else 0
            conditions.append("is_online = ?")
            params.append(online_val)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT mac, ip, hostname, device_type, vendor, serial,
                   first_connected_at, last_seen_at,
                   current_session_seconds, total_connected_seconds,
                   is_online
            FROM device_connection_history
            {where_clause}
            ORDER BY is_online DESC, current_session_seconds DESC, total_connected_seconds DESC
            LIMIT ?
        """
        params.append(limit_val)
        rows = db.execute(sql, params).fetchall()

        return [
            {
                "mac": row["mac"],
                "ip": row["ip"],
                "hostname": row["hostname"] or "",
                "device_type": row["device_type"],
                "vendor": row["vendor"] or "",
                "serial": row["serial"] if "serial" in row.keys() and row["serial"] else "—",
                "first_connected_at": row["first_connected_at"],
                "last_seen_at": row["last_seen_at"],
                "current_session_seconds": row["current_session_seconds"],
                "total_connected_seconds": row["total_connected_seconds"],
                "is_online": int(row["is_online"]),
            }
            for row in rows
        ]
