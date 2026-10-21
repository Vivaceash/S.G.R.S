import pytest
from dashboard_account_activity import assess_activity


def assess(devices, **overrides):
    return assess_activity(devices, **{**dict(users_complete=True, devices_complete=True, forti_complete=True), **overrides})


def device(**overrides):
    return {**dict(deviceMac='aa:bb:cc:dd:ee:01', lastAuthenticationTime=None, forti=None, asociacion='employeeAccount'), **overrides}


@pytest.mark.parametrize('value', [None, '', ' ', 'null'])
def test_explicit_empty_auth_and_no_forti_match_is_inactive(value):
    assert assess([device(lastAuthenticationTime=value)])['status'] == 'inactive'


@pytest.mark.parametrize('source', ['users_complete', 'devices_complete', 'forti_complete'])
def test_incomplete_sources_cannot_confirm_inactivity(source):
    assert assess([device()], **{source: False})['status'] == 'unknown'


def test_any_forti_record_including_offline_prevents_negative_assessment():
    assert assess([device(), device(forti={'status': 'offline', 'last_seen': 123})])['status'] == 'observed'


def test_any_authentication_prevents_inactivity():
    assert assess([device(), device(lastAuthenticationTime='2025-01-01')])['status'] == 'authenticated'


@pytest.mark.parametrize('devices', [[], [{'deviceMac': 'aa:bb:cc:dd:ee:01'}], [device(deviceMac='')], [device(deviceMac='00:00:00:00:00:00')], [device(asociacion='deviceName-prefijo')]])
def test_missing_identity_or_evidence_is_not_inactive(devices):
    assert assess(devices)['status'] == 'unknown'
