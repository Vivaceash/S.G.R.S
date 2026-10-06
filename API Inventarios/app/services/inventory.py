from collections import Counter
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
from pathlib import Path
from app.core.config import settings
from app.core.errors import InventoryError
from app.repositories.database import database

DOCUMENTS = {'Actualización CCTV.xlsx', 'CheckList CCTV.xlsx'}


def now():
    return datetime.now(timezone.utc).isoformat()


def source(db):
    row = db.execute('SELECT revision,payload FROM catalog WHERE id=1').fetchone()
    if not row:
        raise InventoryError(503, 'Importa el catálogo documental antes de consultar CCTV.', 'catalog_unavailable')
    return json.loads(row['payload']), row['revision']


def snapshot():
    with database() as db:
        data, revision = source(db)
        edits = {r['asset_id']: dict(r) for r in db.execute('SELECT * FROM edits')}
        latest = db.execute("SELECT result,status FROM jobs WHERE result IS NOT NULL ORDER BY rowid DESC LIMIT 1").fetchone()
        last_valid = db.execute("SELECT result FROM jobs WHERE status='completed' AND result IS NOT NULL ORDER BY rowid DESC LIMIT 1").fetchone()
    network = json.loads(latest['result']) if latest else {}
    # Keep the last fully confirmed observation visible when a later cycle is
    # partial; attach current source health and mark that observation stale.
    fallback = json.loads(last_valid['result']) if last_valid and latest and latest['status'] == 'partial' else {}
    active = fallback or network
    observations = active.get('assets', {}) if active.get('revision') == revision else {}
    assets = []
    for original in data['assets']:
        edit = edits.get(original['id'])
        fields = json.loads(edit['fields']) if edit else {}
        net = observations.get(original['id'])
        if net:
            net = {**net, 'sources': network.get('sources', [])}
            stamp = active.get('observed_at')
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() if stamp else float('inf')
            net['stale'] = bool(fallback) or age > settings.STALE_SECONDS
            net['observed_at'] = stamp
        assets.append({**original, **fields, 'documented': original,
                       'version': f'{revision}:{edit["version"] if edit else 0}',
                       'corrected_at': edit['updated_at'] if edit else None, 'network': net})
    return {'assets': assets, 'revision': revision, 'cabinets': data.get('cabinets', []),
            'sources': [s for s in data.get('sources', []) if s['file'] in DOCUMENTS],
            'structure': data.get('structure', {})}


def camera(asset_id):
    result = next((a for a in snapshot()['assets'] if a['id'] == asset_id), None)
    if result is None:
        raise InventoryError(404, 'Cámara no encontrada.', 'not_found')
    return result


def correct(asset_id, body, principal):
    fields = body.fields.model_dump(exclude_unset=True)
    if not fields or any(v is None for v in fields.values()):
        raise InventoryError(422, 'Indica campos válidos para corregir.')
    with database(write=True) as db:
        data, revision = source(db)
        original = next((a for a in data['assets'] if a['id'] == asset_id), None)
        if not original:
            raise InventoryError(404, 'Cámara no encontrada.')
        if original['dataset'] != 'cctv':
            raise InventoryError(403, 'El catálogo histórico es de solo lectura.')
        row = db.execute('SELECT * FROM edits WHERE asset_id=?', (asset_id,)).fetchone()
        version = row['version'] if row else 0
        if body.version != f'{revision}:{version}':
            raise InventoryError(409, 'El recurso cambió. Recarga su ficha conservando tu borrador.', 'version_conflict')
        if fields.get('idf_id') and fields['idf_id'] not in {c['id'] for c in data.get('cabinets', [])}:
            raise InventoryError(422, 'Gabinete no válido.')
        before = {**original, **(json.loads(row['fields']) if row else {})}
        merged = {**(json.loads(row['fields']) if row else {}), **fields}
        effective = {**original, **merged}
        if bool(effective.get('destination')) != effective.get('relocated', False):
            raise InventoryError(422, 'La reubicación y el destino deben coincidir.')
        timestamp = now()
        db.execute('INSERT INTO edits VALUES(?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET version=excluded.version,fields=excluded.fields,updated_at=excluded.updated_at',
                   (asset_id, version + 1, json.dumps(merged, ensure_ascii=False), timestamp))
        changes = {k: {'before': before.get(k), 'after': v} for k, v in fields.items()}
        db.execute('INSERT INTO audit(asset_id,actor,action,changes,created_at) VALUES(?,?,?,?,?)',
                   (asset_id, principal.subject, 'inventory.physical.update', json.dumps(changes, ensure_ascii=False), timestamp))
    return camera(asset_id)


def select(data, filters):
    rows = data['assets']
    for key in ('dataset', 'idf_id', 'model', 'decommissioned', 'relocated'):
        value = filters.get(key)
        if value is not None:
            rows = [r for r in rows if r.get(key, False if key in ('decommissioned', 'relocated') else '') == value]
    if filters.get('q'):
        query = filters['q'].casefold()
        rows = [r for r in rows if query in ' '.join(str(r.get(k, '')) for k in ('name', 'number', 'model', 'serial', 'mac', 'documented_ip', 'location', 'destination')).casefold()]
    for key in ('status', 'comparison'):
        if filters.get(key):
            rows = [r for r in rows if (r.get('network') or {}).get(key, 'unknown' if key == 'status' else 'pending') == filters[key]]
    if filters.get('vlan_id') is not None:
        rows = [r for r in rows if (r.get('network') or {}).get('vlan', {}).get('vlan_id') == filters['vlan_id']]
    return sorted(rows, key=lambda r: (str(r.get(filters.get('sort', 'name'), '')).casefold(), r['id']), reverse=filters.get('descending', False))


def integration_cameras(data, query='', idf_id=None):
    """Return the deliberately small CCTV view approved for external modules."""
    rows = [row for row in data['assets'] if row.get('dataset') == 'cctv']
    if idf_id:
        rows = [row for row in rows if row.get('idf_id') == idf_id]
    if query:
        needle = query.casefold()
        rows = [row for row in rows if needle in ' '.join(
            str(row.get(field, '')) for field in ('name', 'idf_id', 'location', 'model', 'destination')
        ).casefold()]
    fields = ('id', 'name', 'idf_id', 'location', 'model', 'decommissioned', 'relocated', 'destination', 'corrected_at')
    return [{field: row.get(field, False if field in ('decommissioned', 'relocated') else '') for field in fields}
            for row in sorted(rows, key=lambda row: (str(row.get('name', '')).casefold(), row['id']))]


def summary(rows):
    return {'total': len(rows), 'active_inventory': sum(not a.get('decommissioned', False) for a in rows),
            'retired': sum(bool(a.get('decommissioned')) for a in rows), 'relocated': sum(bool(a.get('relocated')) for a in rows),
            'by_cabinet': dict(Counter(a.get('idf_id') or 'unknown' for a in rows)),
            'by_model': dict(Counter(a.get('model') or 'unknown' for a in rows)),
            'by_comparison': dict(Counter((a.get('network') or {}).get('comparison', 'pending') for a in rows)),
            'by_network_status': dict(Counter((a.get('network') or {}).get('status', 'unknown') for a in rows))}


def export_csv(rows):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    fields = ('id', 'name', 'dataset', 'idf_id', 'location', 'model', 'serial', 'mac', 'documented_ip', 'decommissioned', 'relocated', 'destination')
    writer.writerow((*fields, 'observed_ip', 'network_status', 'comparison', 'vlan_id', 'observed_at', 'stale'))
    def cell(value):
        text = '' if value is None else str(value)
        return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')) else text
    for row in rows:
        net = row.get('network') or {}
        writer.writerow([cell(row.get(k)) for k in fields] + [cell(v) for v in (net.get('ip'), net.get('status'), net.get('comparison'), net.get('vlan', {}).get('vlan_id'), net.get('observed_at'), net.get('stale'))])
    return '\ufeff' + stream.getvalue()


def download(digest):
    with database() as db:
        data, _ = source(db)
    item = next((s for s in data.get('sources', []) if s.get('sha256') == digest and s.get('file') in DOCUMENTS), None)
    if not item or not data.get('source_directory'):
        raise InventoryError(404, 'Documento no disponible.')
    base = Path(data['source_directory']).resolve()
    path = (base / item['file']).resolve()
    if path.parent != base:
        raise InventoryError(404, 'Documento no disponible.')
    try:
        raw = path.read_bytes()
    except OSError:
        raise InventoryError(404, 'Documento no disponible.') from None
    if hashlib.sha256(raw).hexdigest() != digest:
        raise InventoryError(409, 'La fuente cambió desde su importación.')
    return raw


def history(asset_id, table, limit, offset):
    camera(asset_id)
    assert table in ('audit', 'observations')
    with database() as db:
        total = db.execute(f'SELECT COUNT(*) FROM {table} WHERE asset_id=?', (asset_id,)).fetchone()[0]
        rows = [dict(r) for r in db.execute(f'SELECT * FROM {table} WHERE asset_id=? ORDER BY id DESC LIMIT ? OFFSET ?', (asset_id, limit, offset))]
    for row in rows:
        key = 'changes' if table == 'audit' else 'payload'
        row[key] = json.loads(row[key])
    return {'items': rows, 'total': total, 'limit': limit, 'offset': offset}
