"""General audit feed: original dates, source labels and complete IDF history."""
import json
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import dashboard_access as access
from dashboard_routes import AccessRoutes


class AuditBoundary(AccessRoutes):
    path = '/api/audit'

    def __init__(self, root):
        self.root = root
        self.identity = {'user': {'id': 'auditor', 'role': 'super-admin'}, 'allowed_pages': ['bitacora'], 'capabilities': ['activity.read']}
        self.response = None

    def _boundary(self, mutation=False):
        pass

    def _authorize(self, mutation=False):
        pass

    def report_context(self):
        return self.root / 'data/reports.json', self.root / 'data/idfs.json', threading.RLock()

    def _send_json(self, payload, status=200):
        self.response = status, payload


@pytest.fixture
def audit_feed(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path / 'private')
    monkeypatch.chdir(tmp_path)
    (tmp_path / 'data').mkdir()
    (tmp_path / 'data/idfs.json').write_text(json.dumps([{'id': 'idf-3', 'name': 'IDF Soporte', 'incidents': [{'id': 'embedded', 'date': '2026-09-02T10:00:00-06:00', 'title': 'Inspección histórica'}]}]))
    reports = {'idf-3': {'incidents': [
        {'id': 'IDF-original', 'date': '08/09/2026 19:55', 'title': 'Revisión de gabinete', 'status': 'resolved', 'description': 'Inspección de prueba'},
        {'id': 'IDF-undated', 'date': 'Hoy, 14:15', 'title': 'Registro antiguo', 'status': 'open'},
    ]}}
    (tmp_path / 'data/reports.json').write_text(json.dumps(reports))
    return AuditBoundary(tmp_path)


def fetch(boundary):
    assert boundary.access_get()
    assert boundary.response[0] == 200
    return boundary.response[1]['events']


def test_historical_local_date_is_preserved_instead_of_today(audit_feed):
    events = fetch(audit_feed)
    row = next(row for row in events if row['target'] == 'idf-3:IDF-original')
    expected = int(datetime(2026, 9, 8, 19, 55, tzinfo=ZoneInfo('America/Mexico_City')).timestamp())
    assert row['created_at'] == expected
    assert row['action'] == 'idf.report.created', 'A completed visit is not a separately recorded resolution'
    undated = next(row for row in events if row['target'] == 'idf-3:IDF-undated')
    assert undated['created_at'] is None
    assert undated['original_date'] == 'Hoy, 14:15'
    assert any(row['target'] == 'idf-3:embedded' for row in events)


def test_stored_idf_events_get_readable_labels_without_rewriting_dates(audit_feed):
    with access.database(write=True) as db:
        db.execute('INSERT INTO audit(actor,action,target,created_at,details) VALUES(?,?,?,?,?)', ('auditor', 'idf.report.created', 'idf-3:IDF-original', 1234567890, ''))
    events = fetch(audit_feed)
    rows = [row for row in events if row['target'] == 'idf-3:IDF-original']
    assert len(rows) == 1
    assert rows[0]['target_label'] == 'IDF Soporte · Revisión de gabinete'
    assert rows[0]['created_at'] == 1234567890
    with access.database() as db:
        assert db.execute("SELECT target, created_at FROM audit WHERE action='idf.report.created'").fetchone()[:] == ('idf-3:IDF-original', 1234567890)


def test_panel_report_is_audited_once_and_keeps_real_creation_time(audit_feed):
    from dashboard_reports import ReportRoutes
    class ReportHandler(ReportRoutes):
        identity = {'user': {'id': 'auditor', 'name': 'Técnico de prueba'}}
        def report_context(self):
            return audit_feed.report_context()
        def _send_json(self, payload):
            self.response = payload
    handler = ReportHandler()
    report_id = 'IDF-12345678-1234-1234-1234-123456789abc'
    body = {'idf_id': 'idf-3', 'incident': {'id': report_id, 'date': '1990-01-01', 'temp': 23, 'description': 'Reporte de prueba desde panel', 'status': 'open'}}
    handler.save_report(body)
    saved = handler.response['incident']
    handler.save_report(body)
    assert handler.response['duplicate'] is True
    rows = [row for row in fetch(audit_feed) if row['target'] == f'idf-3:{report_id}']
    assert len(rows) == 1
    assert rows[0]['source'] == 'audit'
    assert abs(rows[0]['created_at'] - datetime.fromisoformat(saved['date']).timestamp()) < 2
    assert rows[0]['target_label'] == 'IDF Soporte · Reporte de incidencia'


def test_resolution_keeps_creation_and_resolution_as_distinct_events(audit_feed):
    reports_file, _, _ = audit_feed.report_context()
    reports_file.write_text(json.dumps({'idf-3': {'incidents': [{
        'id': 'IDF-resolved', 'title': 'Incidencia histórica', 'date': '08/09/2026 19:55',
        'status': 'resolved', 'resolved_at': '2026-10-01T12:00:00-06:00',
    }]}}))
    events = [row for row in fetch(audit_feed) if row['target'] == 'idf-3:IDF-resolved']
    assert {row['action'] for row in events} == {'idf.report.created', 'idf.report.resolved'}
    assert len({row['created_at'] for row in events}) == 2
