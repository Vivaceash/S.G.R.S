import json
from contextlib import contextmanager

import pytest


@pytest.mark.parametrize('forti_available', [True, False])
def test_complete_account_snapshot_includes_all_devices_and_forti_evidence(monkeypatch, tmp_path, forti_available):
    import server

    users = [{'id': 7, 'username': 'cuenta.prueba', 'fullName': 'Cuenta de prueba',
              'telephone': '5551234567', 'accessRoleProfile': '__SSID-Tlaloc',
              'description': 'Cuenta institucional', 'dateOfEffective': 1720000000000,
              'password': 'never-expose', 'policyList': 'private-policy'}]
    devices = [
        {'id': 10, 'employeeAccount': 'cuenta.prueba', 'deviceMac': 'AA:BB:CC:DD:EE:01',
         'deviceName': 'Laptop', 'deviceOS': 'Windows', 'lastAccessDeviceSSID': 'Tlaloc',
         'activeStatus': 'Actived', 'description': 'Equipo institucional', 'devicePSK': 'never-expose'},
        {'id': 11, 'employeeAccount': 'cuenta.prueba', 'deviceMac': 'AA:BB:CC:DD:EE:02',
         'deviceName': 'Celular', 'accessRoleProfile': '__SSID-Ehecatl'},
    ]
    forti = [{'mac': 'aa-bb-cc-dd-ee-01', 'ip': '15.40.2.10', 'hostname': 'PC-Prueba',
              'is_online': True, 'hardware_vendor': 'HP', 'os_name': 'Windows',
              'os_version': '11', 'serial': 'SERIE-123', 'fortigate': 'FG-Principal',
              'interface': 'SSID-Tlaloc', 'user': 'cuenta.prueba', 'ip_source': 'dhcp',
              'raw': {'password': 'never-expose'}}]

    def fetch(url, timeout):
        if '/employees?' in url:
            payload = {'data': {'items': users}}
        elif '/company-properties?' in url:
            payload = {'data': {'items': devices}}
        elif not forti_available:
            return 503, b'{}', 'application/json'
        else:
            payload = {'success': True, 'data': {'devices': forti, 'total_inventory': 1, 'returned_count': 1}}
        return 200, json.dumps(payload).encode(), 'application/json'

    class EmptyDB:
        def execute(self, query):
            return []

    @contextmanager
    def database():
        yield EmptyDB()

    monkeypatch.setattr(server, '_fetch_upstream', fetch)
    monkeypatch.setattr(server, 'database', database)
    monkeypatch.setattr(server, 'CONCESSIONS_FILE', str(tmp_path / 'concessions.json'))

    class Handler(server.Handler):
        def __init__(self):
            self.path = '/api/altas/omnivista'
            self.identity = {'user': {'role': 'super-admin'}}
        def access_get(self):
            return False
        def _send_json(self, data, status=200):
            self.response = data

    handler = Handler()
    handler.do_GET()
    account = handler.response['data']['users'][0]
    assert account['id'] == 7
    assert account['telephone'] == '5551234567'
    assert account['omnivistaEffectiveDate'] == 1720000000000
    assert len(account['devices']) == 2  # Includes the device assigned to another profile.
    laptop, phone = account['devices']
    assert laptop['description'] == 'Equipo institucional'
    assert laptop['lastAccessDeviceSSID'] == 'Tlaloc'
    assert laptop['activeStatus'] == 'Actived'
    if forti_available:
        assert laptop['forti']['serial'] == 'SERIE-123'
        assert laptop['forti']['fortigate'] == 'FG-Principal'
        assert laptop['forti']['os'] == 'Windows 11'
        assert laptop['cotejo'] == 'encontrado'
        assert phone['cotejo'] == 'sin coincidencia en FortiGate'
    else:
        assert laptop['forti'] is None
        assert laptop['cotejo'] == phone['cotejo'] == 'pendiente de cotejo'
    assert 'never-expose' not in json.dumps(handler.response)
    assert 'private-policy' not in json.dumps(handler.response)
