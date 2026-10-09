import json
import threading

import pytest
import dashboard_access as access
from dashboard_presence_collector import collect_presence, presence_snapshot, start_presence_collector
from dashboard_device_history import get_longest_connected_devices


def provider(devices):
    def fetch(service, path):
        assert service == 'forti'
        return 200, json.dumps({'data': {'devices': devices, 'returned_count': len(devices)}}).encode(), 'application/json'
    return fetch


def test_collects_without_login_and_ranks_overnight_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    old = {'mac': 'AA:00:00:00:00:01', 'hostname': 'PC-NIGHT', 'os_name': 'Windows 11', 'is_online': True}
    new = {'mac': 'AA:00:00:00:00:02', 'hostname': 'PC-MORNING', 'os_name': 'Windows 11', 'is_online': True}
    for now in range(1000, 1000 + 8 * 3600 + 1, 60):
        collect_presence(provider([old]), now=now)
    collect_presence(provider([old, new]), now=1000 + 8 * 3600)
    ranked = get_longest_connected_devices(only_online=True)
    assert ranked[0]['hostname'] == 'PC-NIGHT'
    assert ranked[0]['current_session_seconds'] == 8 * 3600
    assert ranked[1]['current_session_seconds'] == 0
    assert presence_snapshot()[old['mac']]['first_connected_at'] == 1000


def test_failure_preserves_history_and_does_not_add_time(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    dev = {'mac': 'AA:00:00:00:00:01', 'is_online': True}
    collect_presence(provider([dev]), now=1000)
    before = presence_snapshot()
    with pytest.raises(ValueError):
        collect_presence(lambda *_: (502, b'{}', 'application/json'), now=1060)
    assert presence_snapshot() == before


def test_worker_samples_before_any_browser_request(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    sampled = threading.Event()
    dev = {'mac': 'AA:00:00:00:00:01', 'is_online': True}
    from dashboard_presence_collector import collect_presence as real_collect
    def collect(fetch):
        result = real_collect(fetch, now=1000)
        sampled.set()
        return result
    monkeypatch.setattr('dashboard_presence_collector.collect_presence', collect)
    stop = start_presence_collector(provider([dev]), interval=60)
    try:
        assert sampled.wait(5)
        assert presence_snapshot()[dev['mac']]['is_online'] == 1
    finally:
        stop.set()
