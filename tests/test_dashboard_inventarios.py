import dashboard_inventarios as boundary
import dashboard_routes
import dashboard_access as access
import httpx
import pytest
from email.message import Message
from dashboard_routes import AccessRoutes


@pytest.mark.parametrize('provider_status', [401, 403])
@pytest.mark.parametrize('path', ['/api/inventory/catalog', '/api/inventarios/cctv/catalog'])
def test_provider_unauthorized_does_not_expire_dashboard_session(monkeypatch, tmp_path, path, provider_status):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    (tmp_path / 'inventarios-active.json').write_text('{}')
    (tmp_path / 'documentary.json').write_text(
        '{"schema_version": 1, "assets": [], "cabinets": [], "sources": []}')
    monkeypatch.setattr(access, 'connection', lambda _: {
        'url': 'http://inventory.test/api/v1', 'secret': 'test-only', 'auth_mode': 'api-key'})
    client = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(provider_status, json={'detail': 'Unauthorized'}))
    monkeypatch.setattr(boundary.httpx, 'Client', lambda **kwargs: client(transport=transport, **kwargs))

    class Route(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            self.identity = {'user': {'id': 'operator-1', 'role': 'admin'}, 'capabilities': ['inventory.read']}

        def _send_json(self, payload, status=200):
            self.response = status, payload

    route = Route()
    route.path = path
    assert route.access_get() is True
    assert route.response[0] == 502, 'Provider authentication failure must not be a dashboard session 401'
    assert 'credencial' in route.response[1]['error']


def test_inventory_still_requires_a_dashboard_session(monkeypatch, tmp_path):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)

    class Route(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _send_json(self, payload, status=200):
            self.response = status, payload

    route = Route()
    route.headers = Message()
    route.path = '/api/inventory/catalog'
    assert route.access_get() is True
    assert route.response[0] == 401


def test_catalog_preserves_observations_from_inventory_api(monkeypatch):
    expected = [{'idf_id': 'idf-1', 'text': 'Revisar canalización'}]
    monkeypatch.setattr(boundary, 'request', lambda *args, **kwargs: {
        'assets': [], 'cabinets': [], 'observations': expected, 'sources': [],
        'structure': {}, 'revision': 'revision-1'})

    assert boundary.catalog()['observations'] == expected


def test_reconcile_starts_and_polls_persisted_job(monkeypatch):
    result = {'revision': 'revision-1', 'assets': {'cam-1': {'comparison': 'matched'}}, 'only_api': []}
    calls = []
    statuses = iter([
        {'id': 'job-1', 'status': 'queued', 'result': None},
        {'id': 'job-1', 'status': 'completed', 'result': result},
    ])

    def fake_request(path, method='GET', body=None, actor=None, binary=False):
        calls.append((path, method, body, actor))
        if method == 'POST':
            return {'id': 'job-1', 'status': 'queued'}
        return next(statuses)

    monkeypatch.setattr(boundary, 'request', fake_request)
    monkeypatch.setattr(boundary.time, 'sleep', lambda _: None)

    assert boundary.reconcile('operator-1') == result
    assert calls[0] == ('/reconciliation/jobs', 'POST', {}, 'operator-1')
    assert calls[1][0] == '/reconciliation/jobs/job-1'


def test_dashboard_reconcile_uses_inventory_service_when_active(monkeypatch):
    expected = {'revision': 'revision-1', 'assets': {}, 'only_api': []}

    class Route(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _authorize(self, mutation=False):
            self.identity = {'user': {'id': 'operator-1', 'role': 'admin'}, 'capabilities': ['inventory.read']}

        def _send_json(self, payload, status=200):
            self.response = status, payload

    monkeypatch.setattr(dashboard_routes.inventories_api, 'active', lambda: True)
    monkeypatch.setattr(dashboard_routes.inventories_api, 'reconcile', lambda actor: expected)
    route = Route()
    route.path = '/api/inventory/reconcile'

    assert route.access_get() is True
    assert route.response == (200, expected)
