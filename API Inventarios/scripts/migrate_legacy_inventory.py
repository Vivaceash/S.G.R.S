"""Importa JSON documental y correcciones, con dry-run predeterminado y corte reversible."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.services.import_service import migrate, rollback_edits
from app.repositories.database import database


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=root / '.sgrs-private/documentary.json')
    parser.add_argument('--legacy-db', type=Path, default=root / '.sgrs-private/dashboard.sqlite3')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--activate', action='store_true', help='Corta escrituras legacy de CCTV después de importar; requiere --apply')
    parser.add_argument('--rollback', action='store_true', help='Detener API Inventarios antes; restaura correcciones y retira marcador')
    args = parser.parse_args()
    if args.activate and not args.apply:
        parser.error('--activate requiere --apply')
    marker = args.legacy_db.parent / 'inventarios-active.json'
    if not args.legacy_db.exists():
        parser.error('No existe la base legacy; para importación independiente usa import_catalog.py.')
    legacy = sqlite3.connect(args.legacy_db.resolve().as_uri() + '?mode=rw', uri=True, timeout=10)
    legacy.row_factory = sqlite3.Row
    if args.apply:
        backup = args.legacy_db.parent / ('dashboard-before-inventarios-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.sqlite3')
        with sqlite3.connect(backup) as dest:
            legacy.backup(dest)
        os.chmod(backup, 0o600)
    try:
        # Refuse a second writer transition; repeat imports stay safe/idempotent.
        if args.activate and marker.exists():
            parser.error('Inventarios ya está activo; la reactivación requiere rollback primero.')
        legacy.execute('BEGIN IMMEDIATE')
        if args.rollback:
            from app.services.import_service import load_catalog
            _, revision = load_catalog(args.catalog)
            with database() as db:
                row = db.execute('SELECT revision FROM catalog WHERE id=1').fetchone()
            if not row or revision != row['revision']:
                parser.error('Revisiones distintas: concilia el catálogo antes del rollback.')
            report = rollback_edits(legacy, args.apply)
            legacy.commit()
            if args.apply:
                marker.unlink(missing_ok=True)
        else:
            report = migrate(args.catalog, legacy, args.apply, args.replace)
            if args.activate:
                if not settings.DASHBOARD_KEY:
                    parser.error('Configura INVENTARIOS_DASHBOARD_KEY antes de activar.')
                temporary = marker.with_suffix('.tmp')
                temporary.write_text(json.dumps({'revision': report['revision']}))
                os.chmod(temporary, 0o600)
                os.replace(temporary, marker)
            legacy.commit()
        print(json.dumps(report, ensure_ascii=False))
    except Exception:
        legacy.rollback()
        raise
    finally:
        legacy.close()


if __name__ == '__main__':
    main()
