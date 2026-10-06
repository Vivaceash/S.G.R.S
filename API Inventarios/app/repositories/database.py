import os
import sqlite3
from contextlib import contextmanager
from app.core.config import settings

SCHEMA = '''
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS catalog(id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edits(asset_id TEXT PRIMARY KEY, version INTEGER NOT NULL, fields TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, changes TEXT NOT NULL, created_at TEXT NOT NULL, legacy_id INTEGER UNIQUE);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, revision TEXT NOT NULL, result TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL, job_id TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS observations_asset ON observations(asset_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs((1)) WHERE status IN ('queued','running');
'''


@contextmanager
def database(write=False):
    path = settings.DATABASE
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript(SCHEMA)
        if write:
            db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
