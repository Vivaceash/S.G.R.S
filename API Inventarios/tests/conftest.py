import json
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if 'app' in sys.modules and not str(getattr(sys.modules['app'], '__file__', '')).startswith(str(ROOT)):
    for name in list(sys.modules):
        if name == 'app' or name.startswith('app.'):
            del sys.modules[name]

from app.core.config import settings
from app.services.import_service import migrate


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'DATABASE', tmp_path / 'inventory.sqlite3')
    monkeypatch.setattr(settings, 'API_KEYS', 'read-test')
    monkeypatch.setattr(settings, 'WRITE_KEYS', 'write-test')
    monkeypatch.setattr(settings, 'EXPORT_KEYS', 'export-test')
    monkeypatch.setattr(settings, 'DASHBOARD_KEY', 'dashboard-test')
    monkeypatch.setattr(settings, 'ENABLE_2FA', False)
    monkeypatch.setattr(settings, 'REFRESH_SECONDS', 0)
    monkeypatch.setattr(settings, 'ALLOWED_HOSTS', ['testserver', 'localhost', '127.0.0.1'])
    data = {'schema_version': 1, 'assets': [
        {'id': 'cam-1', 'dataset': 'cctv', 'name': 'Cámara 1', 'mac': 'AA:BB:CC:DD:EE:01', 'serial': 'CAM-1', 'documented_ip': '192.168.99.20', 'kind': 'equipment', 'idf_id': 'idf-1', 'relocated': False, 'destination': '', 'source': {}, 'issues': []},
        {'id': 'old-1', 'dataset': 'cctv_original', 'name': 'Histórica', 'mac': 'AA:BB:CC:DD:EE:01', 'source': {}, 'issues': []},
        {'id': 'ap-1', 'dataset': 'ap', 'name': 'AP'}],
        'cabinets': [{'id': 'idf-1', 'name': 'IDF 1'}],
        'observations': [{'idf_id': 'idf-1', 'text': 'Revisar canalización'}],
        'sources': [], 'structure': {}, 'source_directory': '/private/files'}
    path = tmp_path / 'catalog.json'
    path.write_text(json.dumps(data))
    migrate(path, apply=True)
    return path


@pytest.fixture
def client(store):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        yield client


def responses(ip='192.168.99.20'):
    def response(provider, endpoint, data):
        return {'provider': provider, 'endpoint': endpoint, 'http': 200, 'observed_at': '2026-10-06T12:00:00+00:00', 'payload': {'success': True, 'data': data}}
    return [response('forti', '/devices?view=operational', {'devices': [{'mac': 'aa:bb:cc:dd:ee:01', 'ip': ip, 'interface': 'cameras', 'is_online': True, 'last_seen': 123, 'hardware_vendor': 'Vendor', 'secret': 'NEVER'}]}),
            response('forti', '/network/arp-table', []), response('forti', '/network/dhcp-leases', []),
            response('forti', '/network/interface-config', [{'name': 'cameras', 'vlan_id': 222, 'parent': 'port3', 'vdom': 'root', 'addresses': ['192.168.98.1/23'], 'subnets': ['192.168.98.0/23']}]),
            response('omni', '/monitoring/devices', [])]
