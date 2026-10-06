import json

import pytest

import server


@pytest.mark.parametrize('lease_code', [200, 503])
def test_meztli_clients_come_from_dhcp_and_stay_in_their_interface(monkeypatch, lease_code):
    pools = {'success': True, 'data': {'pools': [
        {'id': 1, 'interface': 'SSID-Meztli', 'active_leases': 6, 'capacity': 254},
        {'id': 2, 'interface': 'SSID-Tonatiuh', 'active_leases': 1, 'capacity': 254},
    ]}}
    clients = [{'ip': f'192.168.94.{i + 10}', 'interface': 'SSID-Meztli'} for i in range(6)]
    clients.append({'ip': '192.168.93.10', 'interface': 'SSID-Tonatiuh'})
    calls = []

    def fetch(url, timeout=12.0):
        calls.append(url)
        if url.endswith('/network/dhcp-leases'):
            return lease_code, json.dumps({'success': lease_code == 200, 'data': clients}).encode(), 'application/json'
        return 200, json.dumps(pools).encode(), 'application/json'

    monkeypatch.setattr(server, '_fetch_upstream', fetch)

    class Handler(server.Handler):
        def __init__(self):
            self.path = '/api/forti/network/dhcp-pools'

        def access_get(self):
            return False

        def _send_json(self, payload, status=200):
            self.response = (status, payload)

    handler = Handler()
    handler.do_GET()
    status, payload = handler.response
    assert status == 200
    meztli, other = payload['data']['pools']
    assert meztli['active_leases'] == 6
    if lease_code == 200:
        assert meztli['dhcp_clients'] == clients[:6]
    else:
        assert meztli['dhcp_clients'] is None
    assert 'dhcp_clients' not in other
    assert len(calls) == 2
