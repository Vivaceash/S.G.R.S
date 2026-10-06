from collections import Counter
import ipaddress
import re

def mac(value):
    value = re.sub(r'[^a-f0-9]', '', str(value or '').lower())
    return value if len(value) == 12 and value not in ('000000000000', 'ffffffffffff') else ''


def serial(value):
    value = re.sub(r'\s', '', str(value or '').upper())
    return value if value not in ('', 'N/A', '—', '-', 'UNKNOWN', 'S/N') else ''


def address(value):
    try:
        return str(ipaddress.ip_address(str(value)))
    except ValueError:
        return ''


def network_records(provider, payload):
    """Allowlist provider fields: never forward users, secrets, traffic or raw objects."""
    if not isinstance(payload, dict) or payload.get('success') is not True:
        raise ValueError('Invalid provider envelope')
    data = payload.get('data')
    rows = data.get('devices') if provider == 'forti' and isinstance(data, dict) else data
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        raise ValueError('Invalid device collection')
    output = []
    for row in rows:
        first = lambda *keys: next((row[k] for k in keys if isinstance(row.get(k), (str, int)) and not isinstance(row[k], bool) and str(row[k]).strip()), '')
        raw_state = row.get('is_online') if provider == 'forti' else first('status', 'operationalStatus')
        state = ('online' if raw_state is True else 'offline' if raw_state is False else 'unknown') if provider == 'forti' else (
            'online' if str(raw_state).lower() in ('up', 'online') else 'offline' if str(raw_state).lower() in ('down', 'offline') else 'unknown')
        output.append({'provider': provider, 'mac': mac(first('mac', 'macAddress', 'deviceMac', 'chassisMacAddress')),
                       'serial': serial(first('serialNumber', 'serial', 'chassisSerialNumber')),
                       'ip': address(first('ipAddress', 'ip', 'deviceIp')), 'status': state,
                       'name': str(first('name', 'hostname', 'deviceName')), 'model': str(first('model', 'hardware_family')),
                       'interface': str(first('interface')), 'reserved': row.get('is_reserved') is True})
    return output


def reconcile(assets, responses):
    current = [a for a in assets if a['dataset'] != 'cctv_original' and a.get('kind') != 'rack']
    frequencies = {key: Counter(fn(a.get(key)) for a in current if fn(a.get(key))) for key, fn in (('mac', mac), ('serial', serial))}
    states, observations, only_api = [], {}, []
    normalized = {}
    for response in responses:
        provider = response['provider']
        rows = []
        available = response['http'] == 200
        if available:
            try:
                rows = network_records(provider, response['payload'])
            except ValueError:
                available = False
        states.append({'provider': provider, 'available': available, 'count': len(rows) if available else None,
                       'observed_at': response['observed_at'], 'http': response['http']})
        normalized[provider] = rows
    used = set()
    for asset in current:
        matches, ambiguous = [], False
        for state in states:
            provider = state['provider']
            if not state['available']:
                continue
            candidates = []
            for index, row in enumerate(normalized[provider]):
                keys = [key for key, fn in (('mac', mac), ('serial', serial)) if fn(asset.get(key)) and fn(asset.get(key)) == row[key]]
                if keys:
                    # A duplicated documentary identifier cannot authorize a match.
                    unique = any(frequencies[key][(mac if key == 'mac' else serial)(asset.get(key))] == 1 for key in keys)
                    candidates.append((index, row, unique))
            if len(candidates) == 1 and candidates[0][2]:
                index, row, _ = candidates[0]
                # Reject contradictory identities, even if one identifier matches.
                conflict = any(fn(asset.get(key)) and row[key] and fn(asset.get(key)) != row[key]
                               for key, fn in (('mac', mac), ('serial', serial)))
                if conflict:
                    ambiguous = True
                else:
                    used.add((provider, index))
                    matches.append({**row, 'observed_at': state['observed_at']})
            elif candidates:
                ambiguous = True
        contradictory = len({r['ip'] for r in matches if r['ip']}) > 1 or len({r['status'] for r in matches if r['status'] != 'unknown'}) > 1
        if ambiguous or contradictory:
            result = 'ambiguous'
        elif matches:
            result = 'changed' if any(address(asset.get('documented_ip')) and r['ip'] and r['ip'] != address(asset['documented_ip']) for r in matches) else 'matched'
        else:
            result = 'not_observed' if states and all(s['available'] for s in states) else 'unavailable'
        # Unknown/mismatched observations never acquire a documentary IP as a current IP.
        confirmed = matches if result in ('matched', 'changed') else []
        observations[asset['id']] = {'comparison': result, 'observations': matches,
                                      'ip': next((r['ip'] for r in confirmed if r['ip']), ''),
                                      'status': next((r['status'] for r in confirmed if r['status'] != 'unknown'), 'unknown')}
    for provider, rows in normalized.items():
        for index, row in enumerate(rows):
            if (provider, index) not in used:
                only_api.append({**row, 'id': f'{provider}:{index}'})
    return {'sources': states, 'assets': observations, 'only_api': only_api,
            'scope': 'Equipos entregados por las APIs en esta consulta; las ausencias no acreditan bajas.'}


