"""The printed IDF token also authorizes a support movement for a signed-in operator."""
from contextlib import contextmanager
import base64
from email.message import Message
from io import BytesIO
import json
import threading
import uuid

import dashboard_reports as reports
import dashboard_routes as routes
import dashboard_access as access
from dashboard_routes import AccessRoutes


def test_existing_idf_qr_records_support_movement(tmp_path, monkeypatch):
    monkeypatch.setattr(reports, 'PRIVATE', tmp_path)
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    monkeypatch.setenv('SGRS_LAN_ORIGIN', 'http://192.168.38.250:3000')
    monkeypatch.delenv('SGRS_PUBLIC_ORIGIN', raising=False)
    idfs_file = tmp_path / 'idfs.json'
    reports_file = tmp_path / 'reports.json'
    idfs_file.write_text(json.dumps([{'id': 'idf-1', 'name': 'IDF 1', 'zone': 'Planta baja'}]))
    reports_file.write_text('{}')
    identity = {'user': {'id': 'support-1', 'name': 'Técnico de soporte', 'role': 'soporte',
                         'allowed_pages': ['soporte']}, 'allowed_pages': ['soporte'],
                'capabilities': ['idf.read', 'activity.read'], 'csrf': 'csrf-test'}
    monkeypatch.setattr(routes, 'session', lambda cookie: identity if cookie == 'test-session' else None)


    class Route(AccessRoutes, reports.ReportRoutes):
        def report_context(self):
            return reports_file, idfs_file, lock

        def _send_json(self, payload, status=200):
            self.response = status, payload

    lock = threading.Lock()
    route = Route()
    route.client_address = ('192.168.38.80', 12345)
    route.headers = Message()
    route.headers['Host'] = '192.168.38.250:3000'
    route.headers['Origin'] = 'http://192.168.38.250:3000'
    route.headers['Cookie'] = 'test-session'
    route.path = '/api/support/idfs'
    assert route.access_get() is True
    assert route.response[0] == 200
    assert {'id': 'idf-1', 'name': 'IDF 1'} in route.response[1]['idfs']
    assert all(set(row) == {'id', 'name'} for row in route.response[1]['idfs'])

    # The very same capability embedded in the printed Registro IDF QR works here.
    qr_token = reports.mobile_token('idf-1')
    route.path = f'/api/mobile-report?idf=idf-1&token={qr_token}'
    assert route.access_get() is True
    assert route.response[1]['idf']['name'] == 'IDF 1'

    movement_id = str(uuid.uuid4())
    payload = {'id': movement_id, 'idf_id': 'idf-1', 'token': qr_token,
               'actor_name': 'Persona que retiró', 'inventory_item_id': 'idf3-001', 'quantity': 2,
               'identifier': 'TON-001', 'notes': 'Retiro de prueba',
               'evidence': {'type': 'image/png', 'data': base64.b64encode(b'\x89PNG\r\n\x1a\nphoto').decode()}}

    def submit(body, cookie='test-session', csrf='csrf-test'):
        data = json.dumps(body).encode()
        route.path = '/api/support/movements'
        route.headers.replace_header('Cookie', cookie)
        for key, value in (('Content-Type', 'application/json'),
                           ('Content-Length', str(len(data))), ('X-CSRF-Token', csrf)):
            if key in route.headers:
                route.headers.replace_header(key, value)
            else:
                route.headers[key] = value
        route.rfile = BytesIO(data)
        assert route.access_post() is True
        return route.response

    assert submit(payload, cookie='')[0] == 401
    assert submit(payload, csrf='wrong')[0] == 403
    assert submit({**payload, 'token': 'invalid'})[0] == 403
    assert submit({**payload, 'actor_name': ''})[0] == 422
    assert submit({**payload, 'quantity': 4})[0] == 409
    assert submit({**payload, 'evidence': {'type': 'image/png', 'data': 'invalid'}})[0] == 422
    status, result = submit(payload)
    assert status == 200 and result['movement']['identifier'] == 'TON-001'
    assert result['movement']['actor_name'] == 'Persona que retiró'
    assert result['movement']['quantity'] == 2
    assert (tmp_path / 'support-evidence' / result['movement']['evidence']).read_bytes().startswith(b'\x89PNG')
    assert submit(payload)[1]['duplicate'] is True
    assert len(json.loads((tmp_path / 'support-movements.json').read_text())) == 1
    with access.database() as db:
        assert db.execute('SELECT quantity FROM support_inventory WHERE id=?', ('idf3-001',)).fetchone()[0] == 1
    route.path = '/api/support/movements'
    assert route.access_get() is True
    assert route.response[1]['movements'][0]['idf_name'] == 'IDF 1'
