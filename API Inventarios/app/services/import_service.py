from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
from app.core.errors import InventoryError
from app.repositories.database import database


def load_catalog(path):
    raw = Path(path).read_bytes()
    data = json.loads(raw)
    if data.get('schema_version') != 1 or not isinstance(data.get('assets'), list):
        raise InventoryError(422, 'Formato de catálogo no compatible.')
    # Retain exact source revision, IDs and documentary fields for legacy compatibility.
    data['assets'] = [a for a in data['assets'] if a.get('dataset') in ('cctv', 'cctv_original')]
    ids = [a['id'] for a in data['assets']]
    if len(ids) != len(set(ids)) or not ids:
        raise InventoryError(422, 'El catálogo no contiene cámaras o tiene IDs duplicados.')
    return data, hashlib.sha256(raw).hexdigest()


def migrate(path, legacy=None, apply=False, replace=False):
    data, revision = load_catalog(path)
    ids = {a['id'] for a in data['assets']}
    edits, audits = [], []
    if legacy is not None:
        edits = [dict(r) for r in legacy.execute('SELECT * FROM inventory_edits') if r['asset_id'] in ids]
        audits = [dict(r) for r in legacy.execute("SELECT * FROM audit WHERE action='inventory.physical.update'") if r['target'] in ids]
    with database(write=apply) as db:
        current = db.execute('SELECT revision,payload FROM catalog WHERE id=1').fetchone()
        existing = {r['asset_id']: dict(r) for r in db.execute('SELECT * FROM edits')}
        orphaned = sorted(set(existing) - ids)
        conflicting = [e['asset_id'] for e in edits if e['asset_id'] in existing and
                       (e['version'], json.loads(e['fields'])) != (existing[e['asset_id']]['version'], json.loads(existing[e['asset_id']]['fields']))]
        report = {'assets': dict(Counter(a['dataset'] for a in data['assets'])), 'revision': revision,
                  'corrections': len(edits), 'audit_entries': len(audits), 'orphaned': orphaned, 'conflicting': conflicting,
                  'applied': False}
        if not apply:
            return report
        if orphaned or conflicting or (current and current['revision'] != revision and not replace):
            raise InventoryError(409, 'Importación detenida: revisa conflictos, IDs huérfanos o autoriza la nueva revisión.')
        db.execute('INSERT INTO catalog VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
                   (revision, json.dumps(data, ensure_ascii=False)))
        for edit in edits:
            db.execute('INSERT OR IGNORE INTO edits VALUES(?,?,?,?)', (edit['asset_id'], edit['version'], edit['fields'], edit['updated_at']))
        for audit in audits:
            db.execute('INSERT OR IGNORE INTO audit(asset_id,actor,action,changes,created_at,legacy_id) VALUES(?,?,?,?,?,?)',
                       (audit['target'], audit['actor'], audit['action'], '{}', datetime.fromtimestamp(audit['created_at'], timezone.utc).isoformat(), audit['id']))
        report['applied'] = True
        return report


def rollback_edits(legacy, apply=False):
    """Copy all effective corrections back before re-enabling the legacy writer."""
    with database() as db:
        catalog = db.execute('SELECT payload FROM catalog WHERE id=1').fetchone()
        if not catalog:
            raise InventoryError(503, 'Catálogo no importado.')
        edits = [dict(r) for r in db.execute('SELECT * FROM edits')]
    conflicts = []
    for edit in edits:
        old = legacy.execute('SELECT * FROM inventory_edits WHERE asset_id=?', (edit['asset_id'],)).fetchone()
        if old and (old['version'] > edit['version'] or (old['version'] == edit['version'] and json.loads(old['fields']) != json.loads(edit['fields']))):
            conflicts.append(edit['asset_id'])
    if conflicts:
        raise InventoryError(409, 'Conflictos de versión impiden restaurar correcciones.')
    if apply:
        for edit in edits:
            legacy.execute('INSERT INTO inventory_edits VALUES(?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET version=excluded.version,fields=excluded.fields,updated_at=excluded.updated_at',
                           (edit['asset_id'], edit['version'], edit['fields'], edit['updated_at']))
    return {'corrections': len(edits), 'applied': apply}
