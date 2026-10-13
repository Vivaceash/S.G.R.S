"""Native active devices, reconciled addresses and offline DHCP reservations."""
import ipaddress


def mac(value):
    return ''.join(c for c in str(value or '').lower() if c.isalnum())


def normalize_interface_name(value):
    """Return the canonical name for known FortiGate interface aliases."""
    name = str(value or '')
    return 'SSID-Quetzacoatl' if name == 'SSID-Quetzacoat' else name


def collection(payload, key):
    if payload.get('status') not in (None, 'success') or payload.get('limit_reached'):
        raise ValueError('Incomplete provider response')
    result = payload.get('results')
    if isinstance(result, dict):
        result = result.get(key)
    if not isinstance(result, list):
        raise ValueError('Invalid provider collection')
    if isinstance(payload.get('total'), int) and payload['total'] > len(result):
        raise ValueError('Truncated provider collection')
    return result


def current_devices(devices, servers, leases, arp):
    def valid_ip(value):
        try:
            return not ipaddress.ip_address(value).is_unspecified
        except (ValueError, TypeError):
            return False

    def scope(row):
        return normalize_interface_name(row.get('interface') or row.get('intf'))

    def seen(row):
        try:
            return float(row.get('last_seen') or 0)
        except (ValueError, TypeError):
            return 0

    identities = {}
    for row in devices:
        key = (scope(row), mac(row.get('mac')))
        if not key[1]:
            continue
        if key not in identities or (bool(row.get('is_online')), seen(row)) > (bool(identities[key].get('is_online')), seen(identities[key])):
            identities[key] = row

    networks = {}
    for server in servers:
        if server.get('status', 'enable') != 'enable':
            continue
        try:
            network = ipaddress.ip_network(f"{server['default-gateway']}/{server['netmask']}", strict=False)
            networks.setdefault(scope(server), []).append(network)
        except (KeyError, ValueError):
            pass

    def in_scope(ip, intf):
        return valid_ip(ip) and (intf not in networks or any(ipaddress.ip_address(ip) in n for n in networks[intf]))

    # Resolve by MAC first: Device Detection's ipv4_address can be historical
    # even while its native is_online flag is true.
    observations = {}
    owners = {}
    for source, rows in (('arp', arp), ('dhcp', leases)):
        for row in rows:
            intf, ip, m = scope(row), row.get('ip'), mac(row.get('mac'))
            if not m or not in_scope(ip, intf):
                continue
            observations.setdefault((intf, m), {}).setdefault(source, set()).add(ip)
            owners.setdefault((intf, ip), set()).add(m)

    active = {}
    proposals = []
    for key, row in identities.items():
        if not row.get('is_online'):
            continue
        intf, m = key
        active[key] = {**row, 'ip': None, 'is_reserved': False, 'ip_source': 'unconfirmed'}
        observed = observations.get(key, {})
        dhcp, neighbors = observed.get('dhcp', set()), observed.get('arp', set())
        agreed = dhcp & neighbors
        if len(agreed) == 1:
            choices, score, source = agreed, 4, 'dhcp+arp'
        elif len(dhcp) == 1:
            choices, score, source = dhcp, 3, 'dhcp'
        elif len(neighbors) == 1:
            choices, score, source = neighbors, 2, 'arp'
        else:
            ip = row.get('ip')
            choices = {ip} if in_scope(ip, intf) and (not owners.get((intf, ip)) or owners[(intf, ip)] == {m}) else set()
            score, source = 1, 'device-detection'
        for ip in choices:
            proposals.append((score, seen(row), key, ip, source))

    claimed = set()
    for score, timestamp, key, ip, source in sorted(proposals, reverse=True):
        if (key[0], ip) in claimed:
            continue  # Keep the active device, but do not repeat an unconfirmed IP.
        active[key].update(ip=ip, ip_source=source)
        claimed.add((key[0], ip))

    reservations = {}
    for server in servers:
        if server.get('status', 'enable') != 'enable':
            continue
        for reservation in server.get('reserved-address', []):
            if reservation.get('action', 'reserved') != 'reserved':
                continue
            ip, m = reservation.get('ip'), mac(reservation.get('mac'))
            if valid_ip(ip) and len(m) == 12 and m != '000000000000':
                key = (scope(server), ip, m)
                if (key[0], m) in active:
                    active[(key[0], m)].update(is_reserved=True, reserved_ip=ip)
                    continue
                original = identities.get((key[0], m), {})
                reservations[key] = {
                    **original, 'ip': None if (key[0], ip) in claimed else ip, 'mac': reservation.get('mac'), 'interface': key[0],
                    'hostname': original.get('hostname') or reservation.get('description') or 'Equipo con IP reservada',
                    'is_reserved': True, 'is_online': False, 'reserved_ip': ip,
                    'ip_source': 'unconfirmed' if (key[0], ip) in claimed else 'reservation',
                }
    return list(active.values()) + list(reservations.values())
