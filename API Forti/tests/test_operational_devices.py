import pytest
import asyncio
from unittest.mock import AsyncMock
from app.operational_devices import current_devices, collection

A, B = 'aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02'


def device(mac=A, ip='10.0.0.2', online=True, seen=100, interface='lan'):
    return dict(mac=mac, ip=ip, interface=interface, is_online=online, last_seen=seen)


def test_only_online_and_reserved_even_never_detected():
    servers = [{'interface': 'lan', 'reserved-address': [{'mac': B, 'ip': '10.0.0.3'}]}]
    result = current_devices([device(), device(ip='10.0.0.4', online=False)], servers, [], [])
    assert len(result) == 2
    reserved = next(d for d in result if d['is_reserved'])
    assert reserved['ip'] == '10.0.0.3'
    assert not reserved['is_online']


def test_address_disagreement_keeps_active_devices_without_duplicate_ip():
    old, new = device(seen=200), device(mac=B, seen=100)
    result = current_devices([old, new], [], [old], [new])
    assert {d['mac'] for d in result} == {A, B}
    assert all(d['is_online'] for d in result)
    assert len([d for d in result if d['ip'] == '10.0.0.2']) == 1
    assert len([d for d in result if d['ip'] is None and d['ip_source'] == 'unconfirmed']) == 1


def test_without_observation_use_last_owner_within_interface():
    result = current_devices([device(), device(mac=B, seen=200), device(interface='other')], [], [], [])
    assert len(result) == 3
    assert next(d for d in result if d['interface'] == 'lan' and d['ip'])['mac'] == B


def test_current_dhcp_address_replaces_historical_ip_by_mac():
    result = current_devices([device(ip='10.0.0.2')], [], [device(ip='10.0.0.99')], [])
    assert len(result) == 1
    assert result[0]['ip'] == '10.0.0.99'
    assert result[0]['is_online']


def test_active_without_ip_is_not_dropped_and_reservation_does_not_double_count():
    servers = [{'interface': 'lan', 'reserved-address': [{'mac': A, 'ip': '10.0.0.9'}]}]
    result = current_devices([device(ip=None)], servers, [], [])
    assert len(result) == 1
    assert result[0]['is_online'] and result[0]['is_reserved']
    assert result[0]['ip'] is None and result[0]['reserved_ip'] == '10.0.0.9'


def test_arp_outside_known_subnet_is_not_used_for_active_device():
    servers = [{'interface': 'lan', 'default-gateway': '10.0.0.1', 'netmask': '255.255.255.0'}]
    result = current_devices([device(ip='192.168.1.2')], servers, [], [device(ip='169.254.0.2')])
    assert result[0]['is_online'] and result[0]['ip'] is None


def test_reservation_matches_mac_and_configured_ip_not_old_ip():
    servers = [{'interface': 'lan', 'reserved-address': [{'mac': A, 'ip': '10.0.0.9'}]}]
    result = current_devices([device(online=False)], servers, [], [])
    assert len(result) == 1
    assert result[0]['ip'] == '10.0.0.9'
    assert result[0]['is_reserved'] and not result[0]['is_online']


def test_disabled_servers_and_blocked_addresses_are_not_reservations():
    servers = [{'interface': 'lan', 'status': 'disable', 'reserved-address': [{'mac': A, 'ip': '10.0.0.2'}]},
               {'interface': 'lan', 'reserved-address': [{'mac': B, 'ip': '10.0.0.3', 'action': 'block'}]}]
    assert current_devices([], servers, [], []) == []


def test_reserved_address_observed_on_other_active_mac_does_not_hide_device():
    servers = [{'interface': 'lan', 'reserved-address': [{'mac': A, 'ip': '10.0.0.2'}]}]
    result = current_devices([device(mac=B)], servers, [device(mac=B)], [device(mac=B)])
    assert len(result) == 2
    assert next(d for d in result if d['mac'] == B)['ip'] == '10.0.0.2'
    reservation = next(d for d in result if d['mac'] == A)
    assert reservation['is_reserved'] and not reservation['is_online']
    assert reservation['ip'] is None and reservation['reserved_ip'] == '10.0.0.2'


def test_partial_or_failed_source_is_not_an_empty_inventory():
    for payload in ({}, {'status': 'error', 'results': []}, {'results': [], 'limit_reached': True}):
        with pytest.raises(ValueError):
            collection(payload, 'servers')
    assert collection({'status': 'success', 'results': []}, 'servers') == []


def test_operational_endpoint_preserves_native_active_count_and_new_ip(monkeypatch):
    from app.routers.devices import list_connected_devices, fortios_client
    history = [{'mac': A, 'ipv4_address': '10.0.0.2', 'detected_interface': 'lan', 'last_seen': 1},
               {'mac': B, 'ipv4_address': '10.0.0.2', 'detected_interface': 'lan', 'last_seen': 2}]
    native = [{**history[0], 'is_online': True}, {**history[1], 'is_online': True, 'ipv4_address': None}]
    get = AsyncMock(side_effect=[{'results': history, 'total': 2}, {'results': native, 'total': 2}])
    monkeypatch.setattr(fortios_client, 'get_connected_devices', get)
    monkeypatch.setattr(fortios_client, 'request', AsyncMock(return_value={'results': []}))
    monkeypatch.setattr(fortios_client, 'get_dhcp_leases', AsyncMock(return_value={'results': [device(ip='10.0.0.99')]}))
    monkeypatch.setattr(fortios_client, 'get_arp_table', AsyncMock(return_value={'results': []}))
    response = asyncio.run(list_connected_devices(view='operational', status_filter='all', online_only=None,
        active_window=3600, vendor=None, search=None, interface=None, vdom=None))
    assert response.data.online_devices == 2
    assert next(d for d in response.data.devices if d.mac == A).ip == '10.0.0.99'
    assert next(d for d in response.data.devices if d.mac == B).ip is None
    assert 'timestamp_from' not in get.call_args_list[1].kwargs['params']


def test_transient_empty_active_snapshot_is_retried(monkeypatch):
    from app.routers.devices import list_connected_devices, fortios_client
    history = [device()]
    get = AsyncMock(side_effect=[{'results': history}, {'results': []}, {'results': history}])
    monkeypatch.setattr(fortios_client, 'get_connected_devices', get)
    monkeypatch.setattr(fortios_client, 'request', AsyncMock(return_value={'results': []}))
    monkeypatch.setattr(fortios_client, 'get_dhcp_leases', AsyncMock(return_value={'results': []}))
    monkeypatch.setattr(fortios_client, 'get_arp_table', AsyncMock(return_value={'results': []}))
    response = asyncio.run(list_connected_devices(view='operational', status_filter='all', online_only=None,
        active_window=3600, vendor=None, search=None, interface=None, vdom=None))
    assert response.data.online_devices == 1
    assert get.await_count == 3


@pytest.mark.parametrize('retry', [{'results': []}, {'status': 'error', 'results': []}, RuntimeError('unavailable')])
def test_unverified_empty_snapshot_does_not_publish_offline_reservations(monkeypatch, retry):
    from fastapi import HTTPException
    from app.routers.devices import list_connected_devices, fortios_client
    get = AsyncMock(side_effect=[{'results': [device()]}, {'results': []}, retry])
    monkeypatch.setattr(fortios_client, 'get_connected_devices', get)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(list_connected_devices(view='operational', status_filter='all', online_only=None,
            active_window=3600, vendor=None, search=None, interface=None, vdom=None))
    assert exc.value.status_code == 502
