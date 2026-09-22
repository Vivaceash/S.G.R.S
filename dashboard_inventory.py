"""Documentary inventory, physical corrections and conservative API reconciliation."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import re
from pathlib import Path

import dashboard_access as access


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


def source_catalog():
    path = access.PRIVATE / 'documentary.json'
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise access.AccessError(503, 'El catálogo documental todavía no está importado.') from None
    data = json.loads(raw)
    if data.get('schema_version') != 1 or not isinstance(data.get('assets'), list):
        raise access.AccessError(503, 'El catálogo documental no tiene un formato compatible.')
    return data, hashlib.sha256(raw).hexdigest()


def catalog():
    data, revision = source_catalog()
    with access.database() as db:
        edits = {r['asset_id']: dict(r) for r in db.execute('SELECT * FROM inventory_edits')}
    rows = []
    for original in data['assets']:
        edit = edits.get(original['id'])
        fields = json.loads(edit['fields']) if edit else {}
        rows.append({**original, **fields, 'documented': original,
                     'version': f'{revision}:{edit["version"] if edit else 0}',
                     'corrected_at': edit['updated_at'] if edit else None})
    return {**{k: v for k, v in data.items() if k != 'source_directory'}, 'assets': rows, 'revision': revision}


def cabinets_with_documentary(local):
    """Add missing cabinet choices consolidating IDF 13 into PACS and without replacing local devices."""
    try:
        data, _ = source_catalog()
    except access.AccessError:
        return local
    known = {r['id'] for r in local}
    if 'idf-pacs' in known or any(r.get('name') == 'PACS' for r in local):
        known.add('idf-13')
    return [*local, *[{**c, 'zone': 'Ubicación documental', 'devices': [], 'incidents': []}
                     for c in data['cabinets'] if c['id'] not in known]]


def source_download(identifier):
    data, _ = source_catalog()
    allowed = {'CheckList completo IDFs.docx', 'Formato_de_AP[1].docx', 'Actualización CCTV.xlsx', 'CheckList CCTV.xlsx'}
    source = next((s for s in data['sources'] if s['sha256'] == identifier and s['file'] in allowed), None)
    if not source or not data.get('source_directory'):
        raise access.AccessError(404, 'Documento no disponible.')
    path = Path(data['source_directory']) / source['file']
    try:
        raw = path.read_bytes()
    except OSError:
        raise access.AccessError(404, 'El documento original no está disponible en el servidor.') from None
    if hashlib.sha256(raw).hexdigest() != identifier:
        raise access.AccessError(409, 'El documento cambió desde la importación. Revisa las fuentes antes de descargar.')
    return raw, 'inventario.docx' if path.suffix == '.docx' else 'inventario.xlsx'


def save_asset(body, actor):
    asset_id = body.get('id')
    data, revision = source_catalog()
    original = next((r for r in data['assets'] if r['id'] == asset_id), None)
    if not original:
        raise access.AccessError(404, 'El recurso ya no está en este catálogo. Actualiza la consulta.')
    if original['dataset'] == 'cctv_original':
        raise access.AccessError(403, 'El catálogo original se conserva como referencia histórica.')
    allowed = {'name', 'idf_id', 'location', 'rack', 'ports', 'notes'}
    if original['dataset'] == 'cctv':
        allowed |= {'relocated', 'destination'}
    fields = body.get('fields')
    if not isinstance(fields, dict) or not fields or set(fields) - allowed:
        raise access.AccessError(422, 'Solo se pueden corregir los datos físicos del recurso.')
    for key, value in fields.items():
        if key == 'relocated':
            if not isinstance(value, bool):
                raise access.AccessError(422, 'Indica si la cámara fue reubicada.')
        elif not isinstance(value, str) or len(value) > (1000 if key == 'notes' else 240):
            raise access.AccessError(422, 'Revisa la longitud y el formato de los campos.')
    fields = {k: v.strip() if isinstance(v, str) else v for k, v in fields.items()}
    if 'name' in fields and not fields['name']:
        raise access.AccessError(422, 'Indica una descripción del recurso.')
    if fields.get('idf_id') and fields['idf_id'] not in {r['id'] for r in data['cabinets']}:
        raise access.AccessError(422, 'Selecciona un gabinete del catálogo documental.')
    with access.database(write=True) as db:
        current = db.execute('SELECT * FROM inventory_edits WHERE asset_id=?', (asset_id,)).fetchone()
        version = current['version'] if current else 0
        if body.get('version') != f'{revision}:{version}':
            raise access.AccessError(409, 'El recurso cambió. Conserva tus cambios y vuelve a abrirlo desde la consulta actualizada.')
        saved = {**(json.loads(current['fields']) if current else {}), **fields}
        effective = {**original, **saved}
        if original['dataset'] == 'cctv' and bool(effective.get('destination')) != effective.get('relocated', False):
            raise access.AccessError(422, 'La reubicación y su destino deben coincidir antes de guardar.')
        now = datetime.now(timezone.utc).isoformat()
        db.execute('INSERT INTO inventory_edits(asset_id,version,fields,updated_at) VALUES(?,?,?,?) '
                   'ON CONFLICT(asset_id) DO UPDATE SET version=excluded.version,fields=excluded.fields,updated_at=excluded.updated_at',
                   (asset_id, version + 1, json.dumps(saved, ensure_ascii=False), now))
        access.audit(db, actor, 'inventory.physical.update', asset_id)
    return {'asset': {**original, **saved, 'documented': original, 'version': f'{revision}:{version + 1}', 'corrected_at': now}}


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


def live_reconciliation(fetch):
    snapshot = catalog()
    def query(pair):
        provider, endpoint = pair
        try:
            code, raw, _ = fetch(provider, endpoint)
            payload = json.loads(raw)
        except Exception:
            code, payload = 502, {}
        return {'provider': provider, 'http': code, 'payload': payload, 'observed_at': datetime.now(timezone.utc).isoformat()}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(query, [('forti', '/devices?view=operational'), ('omni', '/monitoring/devices')]))
    return {**reconcile(snapshot['assets'], responses), 'revision': snapshot['revision']}
