"""Public IDF QR reports must work across LANs without an account session."""
from email.message import Message
from io import BytesIO
import json
import threading
import uuid

import pytest

import dashboard_access as access
import dashboard_reports as reports
from dashboard_routes import AccessRoutes


@pytest.mark.parametrize('client_ip', ['192.168.38.80', '192.168.10.80', '10.20.1.80', '172.20.1.80', '15.40.2.80'])
def test_lan_qr_context_and_report_without_login(tmp_path, monkeypatch, client_ip):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    monkeypatch.setattr(reports, 'PRIVATE', tmp_path)
    monkeypatch.setenv('SGRS_LAN_ORIGIN', 'http://192.168.38.250:3000')
    monkeypatch.delenv('SGRS_PUBLIC_ORIGIN', raising=False)
    idfs_file = tmp_path / 'idfs.json'
    reports_file = tmp_path / 'reports.json'
    idfs_file.write_text(json.dumps([{'id': 'idf-1', 'name': 'IDF 01', 'zone': 'Planta baja'}]))
    reports_file.write_text('{}')
    lock = threading.Lock()

    class Route(AccessRoutes, reports.ReportRoutes):
        def report_context(self):
            return reports_file, idfs_file, lock

        def _send_json(self, payload, status=200):
            self.response = status, payload

    route = Route()
    route.client_address = (client_ip, 12345)
    route.headers = Message()
    route.headers['Host'] = '192.168.38.250:3000'
    route.headers['Origin'] = 'http://192.168.38.250:3000'
    token = reports.mobile_token('idf-1')
    route.path = '/api/mobile-report?idf=idf-1&token=' + token
    assert route.access_get() is True
    assert route.response == (200, {'idf': {'id': 'idf-1', 'name': 'IDF 01', 'zone': 'Planta baja'}})
    assert not hasattr(route, 'identity'), 'QR report must not require account login'

    body = json.dumps({'idf_id': 'idf-1', 'token': token, 'actor': 'Prueba LAN',
                       'incident': {'id': 'IDF-' + str(uuid.uuid4()), 'temp': 23,
                                    'status': 'open', 'description': 'Prueba aislada de reporte'}}).encode()
    route.path = '/api/mobile-report'
    route.headers['Content-Type'] = 'application/json'
    route.headers['Content-Length'] = str(len(body))
    route.rfile = BytesIO(body)
    assert route.access_post() is True
    assert route.response[0] == 200
    stored = json.loads(reports_file.read_text())['idf-1']['incidents']
    assert len(stored) == 1
    assert stored[0]['tech'] == 'Prueba LAN'
    assert stored[0]['description'] == 'Prueba aislada de reporte'

    invalid = json.dumps({'idf_id': 'idf-1', 'token': 'invalid'}).encode()
    route.headers.replace_header('Content-Length', str(len(invalid)))
    route.rfile = BytesIO(invalid)
    assert route.access_post() is True
    assert route.response[0] == 403
    assert len(json.loads(reports_file.read_text())['idf-1']['incidents']) == 1


def test_qr_token_is_permanent_and_unique_per_idf(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    monkeypatch.setattr(reports, 'PRIVATE', tmp_path)
    monkeypatch.setenv('SGRS_LAN_ORIGIN', 'http://192.168.38.250:3000')
    monkeypatch.delenv('SGRS_PUBLIC_ORIGIN', raising=False)
    token = reports.mobile_token('idf-1')
    assert token == reports.mobile_token('idf-1')
    assert token != reports.mobile_token('idf-2')

    monkeypatch.setattr(reports, 'PRIVATE', tmp_path / 'after-restart')
    assert reports.mobile_token('idf-1') == token

    idfs_file = tmp_path / 'idfs.json'
    idfs_file.write_text(json.dumps([{'id': 'idf-1', 'name': 'IDF 01'}]))
    reports_file = tmp_path / 'reports.json'
    reports_file.write_text('{}')
    lock = threading.Lock()

    class Route(AccessRoutes, reports.ReportRoutes):
        def report_context(self):
            return reports_file, idfs_file, lock

        def _send_json(self, payload, status=200):
            self.response = status, payload

    route = Route()
    route.client_address = ('192.168.38.80', 12345)
    route.headers = Message()
    route.headers['Host'] = '192.168.38.250:3000'
    route.headers['Origin'] = 'http://192.168.38.250:3000'
    route.path = '/api/mobile-report?idf=idf-1&token=' + token
    assert route.access_get() is True
    assert route.response[0] == 200
