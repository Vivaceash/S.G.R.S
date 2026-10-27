"""Connection tests must reject credentials even when public health is green."""
import json
import pytest
import server


@pytest.mark.parametrize('service,path', [('forti', '/system/status'), ('omni', '/catalogs/device-options'), ('inventarios', '/catalogs/cabinets')])
@pytest.mark.parametrize('status', [401, 403, 200])
def test_probe_checks_protected_endpoint_before_health(monkeypatch, service, path, status):
    calls = []
    health = (200, json.dumps({'success': True, 'data': {}}).encode(), 'application/json')
    rejected = (status, b'{"error":"rejected"}', 'application/json')

    def request(value, suffix, timeout):
        calls.append(suffix)
        return rejected if suffix == path and status != 200 else health

    monkeypatch.setattr(server, '_configured_request', request)
    handler = server.Handler.__new__(server.Handler)
    result = handler.probe_connection({'id': service})
    assert calls[0] == path
    if status != 200:
        assert result == rejected
        assert calls == [path]
    else:
        assert result == health
        assert calls == [path, '/health' if service == 'forti' else '/system/health']


@pytest.mark.parametrize('payload,ctype', [
    (b'{"success":false,"data":{}}', 'application/json'),
    (b'{"error":"invalid credential"}', 'application/json'),
    (b'{}', 'application/json'),
    (b'null', 'application/json'),
    (b'<html>Login</html>', 'text/html'),
])
def test_probe_rejects_http_200_without_valid_authenticated_data(monkeypatch, payload, ctype):
    calls = []

    def request(value, suffix, timeout):
        calls.append(suffix)
        return 200, payload, ctype

    monkeypatch.setattr(server, '_configured_request', request)
    handler = server.Handler.__new__(server.Handler)
    assert handler.probe_connection({'id': 'forti'})[0] == 502
    assert calls == ['/system/status']


@pytest.mark.parametrize('failed_service', ['forti', 'omni', None])
def test_dashboard_health_requires_authenticated_probe(monkeypatch, failed_service):
    calls = []

    class Handler(server.Handler):
        def __init__(self):
            self.path = '/api/health'

        def access_get(self):
            return False

        def probe_connection(self, config):
            service = config['id']
            calls.append(service)
            data = {'fortigate_connection': {'reachable': True}} if service == 'forti' else {'omnivista_connected': True}
            return (403 if service == failed_service else 200,
                    json.dumps({'success': True, 'data': data}).encode(), 'application/json')

        def _send_json(self, value, status=200):
            self.result = value

    monkeypatch.setattr(server, 'connection', lambda service: {'id': service})
    handler = Handler()
    handler.do_GET()
    assert calls == ['forti', 'omni']
    assert handler.result['status'] == ('degraded' if failed_service else 'ok')
    for service in ('forti', 'omni'):
        assert handler.result[service] is (service != failed_service)
