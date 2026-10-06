import json
import sqlite3
import pytest
from app.services.import_service import migrate, rollback_edits
from app.services.inventory import snapshot, correct
from app.schemas.cctv import Correction
from app.core.security import Principal
from app.core.errors import InventoryError


def legacy_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript('CREATE TABLE inventory_edits(asset_id TEXT PRIMARY KEY,version INTEGER,fields TEXT,updated_at TEXT); CREATE TABLE audit(id INTEGER,actor TEXT,action TEXT,target TEXT,created_at INTEGER);')
    db.execute('INSERT INTO inventory_edits VALUES(?,?,?,?)', ('cam-1', 3, '{"location":"Existing","decommissioned":true}', '2026-10-01T00:00:00+00:00'))
    db.execute('INSERT INTO audit VALUES(1,?,?,?,?)', ('operator', 'inventory.physical.update', 'cam-1', 1700000000))
    return db


def test_idempotent_migration_and_rollback(store):
    legacy = legacy_db()
    before = migrate(store, legacy)
    assert before['corrections'] == 1 and not before['applied']
    migrate(store, legacy, apply=True)
    migrate(store, legacy, apply=True)
    row = snapshot()['assets'][0]
    assert row['location'] == 'Existing' and row['version'].endswith(':3')
    assert 'location' not in row['documented']
    correct(row['id'], Correction(version=row['version'], fields={'location': 'New'}), Principal('test', {'write'}))
    with pytest.raises(InventoryError):
        migrate(store, legacy, apply=True)
    rollback_edits(legacy, apply=True)
    saved = legacy.execute('SELECT * FROM inventory_edits').fetchone()
    assert saved['version'] == 4 and json.loads(saved['fields'])['location'] == 'New'


def test_reimport_does_not_silently_orphan_corrections(store):
    legacy = legacy_db()
    migrate(store, legacy, apply=True)
    data = json.loads(store.read_text())
    data['assets'][0]['id'] = 'replacement'
    store.write_text(json.dumps(data))
    assert migrate(store)['orphaned'] == ['cam-1']
    with pytest.raises(InventoryError):
        migrate(store, apply=True, replace=True)
