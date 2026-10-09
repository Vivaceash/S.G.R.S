"""IDF overview permissions: API enforcement, minimal data and one-time compatibility."""
import json

import pytest

import dashboard_access as access
from dashboard_reports import idf_overview
from dashboard_routes import AccessRoutes


class Boundary(AccessRoutes):
    def __init__(self, path, pages, capabilities=None):
        self.path = path
        self.identity = {
            'user': {'id': 'test-operator', 'role': 'admin'},
            'allowed_pages': pages,
            'capabilities': access.capabilities('admin') if capabilities is None else capabilities,
        }
        self.response = None

    def _boundary(self, mutation=False):
        pass

    def _authorize(self, mutation=False):
        pass

    def _send_json(self, payload, status=200):
        self.response = status, payload

    def _body(self):
        pytest.fail('Denied requests must not reach the body or storage')


@pytest.mark.parametrize('endpoint', ['/api/idfs', '/api/reports'])
@pytest.mark.parametrize('pages', [[], ['bitacora'], ['idf'], ['bitacora-idf'], ['idf', 'bitacora-idf']])
@pytest.mark.parametrize('view', ['individual', 'general'])
def test_idf_read_permission_matrix(endpoint, pages, view):
    handler = Boundary(endpoint + ('' if view == 'individual' else '?view=general'), pages)
    required = 'idf' if view == 'individual' else 'bitacora-idf'
    handled = handler.access_get()
    if required in pages:
        assert handled is False
        assert handler.idf_read_view == view
    else:
        assert handled is True
        assert handler.response[0] == 403


@pytest.mark.parametrize('query', ['?view=', '?view=other', '?view=general&view=individual'])
def test_invalid_view_cannot_bypass_permissions(query):
    handler = Boundary('/api/idfs' + query, ['idf', 'bitacora-idf'])
    assert handler.access_get() is True
    assert handler.response[0] == 422


@pytest.mark.parametrize('path', ['/api/idfs?view=general', '/api/reports?view=general'])
def test_page_permission_still_requires_read_capability(path):
    handler = Boundary(path, ['bitacora-idf'], [])
    assert handler.access_get() is True
    assert handler.response[0] == 403


@pytest.mark.parametrize('path', ['/api/reports', '/api/reports/resolve', '/api/idfs/device', '/api/inventory/asset'])
def test_overview_only_operator_cannot_mutate(path):
    handler = Boundary(path, ['bitacora-idf'])
    assert handler.access_post() is True
    assert handler.response[0] == 403


@pytest.mark.parametrize('path', ['/api/inventory/catalog', '/api/inventory/reconcile',
                                  '/api/inventory/documents/example', '/api/inventarios/cctv/catalog',
                                  '/api/audit', '/api/reports/evidence/example'])
def test_unassigned_data_surfaces_are_denied(path):
    pages = ['bitacora-idf'] if '/evidence/' not in path else []
    handler = Boundary(path, pages)
    assert handler.access_get() is True
    assert handler.response[0] == 403


def test_overview_projection_preserves_log_without_inventory_or_qr():
    cabinets = [{'id': 'idf-1', 'name': 'IDF-01', 'zone': 'Floor', 'mobile_token': 'private-token',
                 'devices': [{'mac': 'private-mac', 'serial': 'private-serial', 'status': 'offline'}],
                 'incidents': [{'id': 'visit-1', 'description': 'Inspection', 'status': 'open'}]}]
    projected = idf_overview(cabinets)
    assert projected[0]['device_count'] == 1
    assert projected[0]['offline_count'] == 1
    assert projected[0]['incidents'][0]['description'] == 'Inspection'
    assert len(projected[0]['incidents'][0]['record_key']) == 64
    assert 'private-' not in json.dumps(projected)
    assert cabinets[0]['mobile_token'] == 'private-token'


@pytest.mark.parametrize('view', ['general', 'individual'])
def test_http_handler_serves_scoped_query_without_leaking_inventory(tmp_path, monkeypatch, view):
    import server

    cabinets = [{'id': 'idf-1', 'name': 'IDF-01', 'devices': [{'mac': 'private-mac'}], 'incidents': []}]
    idfs_file = tmp_path / 'idfs.json'
    idfs_file.write_text(json.dumps(cabinets), encoding='utf-8')
    monkeypatch.setattr(server, 'IDFS_FILE', idfs_file)
    monkeypatch.setattr(server, 'cabinets_with_documentary', lambda rows: rows)
    handler = object.__new__(server.Handler)
    handler.path = '/api/idfs?view=' + view
    handler._boundary = lambda mutation=False: None
    handler.identity = Boundary('', ['bitacora-idf'] if view == 'general' else ['idf']).identity
    handler._authorize = lambda mutation=False: None
    handler.mobile_token = lambda identifier: 'private-token'
    responses = []
    handler._send_json = lambda payload, status=200: responses.append((status, payload))
    handler.do_GET()
    assert responses[0][0] == 200
    cabinet = responses[0][1][0]
    if view == 'general':
        assert 'devices' not in cabinet
        assert 'mobile_token' not in cabinet
        assert cabinet['device_count'] == 1
    else:
        assert cabinet['devices'][0]['mac'] == 'private-mac'
        assert cabinet['mobile_token'] == 'private-token'


def test_permission_migration_preserves_old_access_and_honors_later_revocation(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path / 'private')
    with access.database(write=True) as db:
        for identifier, pages in [('legacy-full', ['idf', 'bitacora']), ('legacy-idf', ['idf']),
                                  ('legacy-audit', ['bitacora']), ('legacy-empty', [])]:
            db.execute('INSERT INTO users(id, username, name, role, password_hash, version, created_at, allowed_pages) '
                       'VALUES (?,?,?,\'admin\',\'unused\',1,0,?)',
                       (identifier, identifier, identifier, json.dumps(pages)))
        db.execute('DELETE FROM dashboard_migrations WHERE id=?', ('idf-overview-page-v1',))
    with access.database(write=True) as db:
        rows = {row['id']: dict(row) for row in db.execute('SELECT * FROM users')}
        assert json.loads(rows['legacy-full']['allowed_pages']) == ['idf', 'bitacora', 'bitacora-idf']
        assert rows['legacy-full']['version'] == 2
        for identifier in ('legacy-idf', 'legacy-audit', 'legacy-empty'):
            assert 'bitacora-idf' not in json.loads(rows[identifier]['allowed_pages'])
            assert rows[identifier]['version'] == 1
        db.execute('UPDATE users SET allowed_pages=? WHERE id=?',
                   (json.dumps(['idf', 'bitacora']), 'legacy-full'))
    with access.database() as db:
        row = db.execute('SELECT allowed_pages, version FROM users WHERE id=?', ('legacy-full',)).fetchone()
        assert 'bitacora-idf' not in json.loads(row['allowed_pages'])
        assert row['version'] == 2
