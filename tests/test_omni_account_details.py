import json
import threading

import pytest

from dashboard_omni_accounts import account_details, employee_index


@pytest.fixture
def employee():
    return {'username': 'armando.sistemas', 'fullName': 'Armando Sistemas',
            'department': 'Sistemas', 'description': 'Personal de sistemas',
            'dateOfEffective': 1720000000000, 'password': 'must-not-be-projected'}


@pytest.mark.parametrize('device', [
    {'employeeAccount': 'ARMANDO.SISTEMAS'},
    {'account': 'armando.sistemas'},
    {'deviceName': 'armando.sistemas'},
    {'deviceName': 'armando.sistemas - cel'},
    {'deviceName': 'armando.sistemas-lap'},
])
def test_account_identity_sources_project_only_allowed_fields(employee, device):
    details = account_details(device, employee_index([employee]))
    assert details['account'] == employee['username']
    assert details['full_name'] == employee['fullName']
    assert details['department'] == employee['department']
    assert details['description'] == employee['description']
    assert details['account_effective_at'] == employee['dateOfEffective']
    assert 'password' not in details


def test_unknown_explicit_account_and_partial_names_do_not_select_another_person(employee):
    index = employee_index([employee])
    assert account_details({'account': 'otra.cuenta', 'deviceName': employee['username']}, index) == {}
    assert account_details({'deviceName': 'armando.sistemas-extra'}, index) == {}


def test_shared_email_is_ambiguous(employee):
    index = employee_index([{**employee, 'email': 'shared@example.test'},
                            {'username': 'otra.cuenta', 'email': 'shared@example.test'}])
    assert account_details({'account': 'shared@example.test'}, index) == {}


@pytest.mark.parametrize('employee_payload', [None, 'invalid'])
def test_device_cache_joins_accounts_and_survives_employee_failure(monkeypatch, employee, employee_payload):
    import server
    monkeypatch.setattr(server, '_omni_devices_cache', {'by_mac': {}, 'updated_at': 0, 'fetching': False})

    def fetch(url, timeout):
        if '/employees?' in url:
            body = json.dumps({'data': {'items': [employee]}}).encode() if employee_payload is None else b'invalid'
        else:
            body = json.dumps({'data': {'items': [{'deviceMac': 'AA:BB:CC:DD:EE:01',
                                                 'deviceName': employee['username']}]}}).encode()
        return 200, body, 'application/json'

    monkeypatch.setattr(server, '_fetch_upstream', fetch)
    server._refresh_omni_devices_cache()
    result = server.get_omni_device_by_mac('AA:BB:CC:DD:EE:01')
    assert result['matched'] is True
    if employee_payload is None:
        assert result['full_name'] == employee['fullName']
    else:
        assert 'full_name' not in result
    assert 'password' not in result


def test_detail_waits_for_an_already_running_cold_cache_refresh(monkeypatch, employee):
    import server
    monkeypatch.setattr(server, '_omni_devices_cache', {'by_mac': {}, 'updated_at': 0, 'fetching': False})
    monkeypatch.setattr(server, '_omni_refresh_thread', None)
    started, release = threading.Event(), threading.Event()

    def fetch(url, timeout):
        if '/employees?' in url:
            started.set()
            assert release.wait(2)
            items = [employee]
        else:
            items = [{'deviceMac': 'D8:9C:67:78:94:31', 'deviceName': employee['username']}]
        return 200, json.dumps({'data': {'items': items}}).encode(), 'application/json'

    monkeypatch.setattr(server, '_fetch_upstream', fetch)
    worker = server._start_omni_refresh()
    assert started.wait(2)
    assert not server._omni_devices_cache['by_mac']

    class DetailHandler(server.Handler):
        def __init__(self):
            self.path = '/api/devices/omnivista?mac=d8:9c:67:78:94:31'
        def access_get(self):
            return False
        def _send_json(self, payload, status=200):
            self.response = payload

    timer = threading.Timer(.03, release.set)
    timer.start()
    try:
        handler = DetailHandler()
        handler.do_GET()
        assert handler.response['status'] == 'matched'
        assert handler.response['omnivista']['full_name'] == employee['fullName']
        assert server._omni_refresh_thread is worker
    finally:
        release.set()
        worker.join(2)
        timer.join()


@pytest.mark.parametrize('ready, expected', [(True, 'not_found'), (False, 'unavailable')])
def test_detail_reports_missing_match_or_provider_failure(monkeypatch, ready, expected):
    import server
    monkeypatch.setattr(server, '_omni_devices_cache', {'by_mac': {}, 'updated_at': 1 if ready else 0, 'complete': ready, 'fetching': False})
    monkeypatch.setattr(server, 'ensure_omni_cache_warm', lambda max_wait: None)
    class DetailHandler(server.Handler):
        def __init__(self):
            self.path = '/api/devices/omnivista?mac=d8:9c:67:78:94:31'
        def access_get(self):
            return False
        def _send_json(self, payload, status=200):
            self.response = payload
    handler = DetailHandler()
    handler.do_GET()
    assert handler.response == {'status': expected, 'omnivista': None}
