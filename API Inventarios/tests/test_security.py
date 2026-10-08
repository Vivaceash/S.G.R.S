from app.core.config import settings
from app.core.sessions import get_totp_secret_for_account, get_totp_token


def test_2fa_preserves_scopes_and_service_auth(client, monkeypatch):
    monkeypatch.setattr(settings, 'ENABLE_2FA', True)
    monkeypatch.setattr(settings, 'JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setattr(settings, 'TOTP_SECRET_KEY', 't' * 40)
    headers = {'X-API-Key': 'read-test'}
    assert client.get('/api/v1/cctv/cameras', headers=headers).status_code == 401
    secret = get_totp_secret_for_account('read-test', 'Operator')
    token = client.post('/api/v1/auth/verify-2fa', json={'api_key': 'read-test', 'account_name': 'Operator', 'totp_code': get_totp_token(secret)}).json()['access_token']
    auth = {'Authorization': 'Bearer ' + token}
    assert client.get('/api/v1/cctv/cameras', headers=auth).status_code == 200
    assert client.get('/api/v1/cctv/export', headers=auth).status_code == 403
    assert client.get('/api/v1/cctv/cameras', headers={'X-API-Key': 'dashboard-test'}).status_code == 200
    assert client.post('/api/v1/auth/setup-2fa', json={'api_key': 'read-test'}).status_code == 403


def test_no_credentials_never_opens_access(client, monkeypatch):
    for name in ('API_KEYS', 'WRITE_KEYS', 'EXPORT_KEYS', 'DASHBOARD_KEY'):
        monkeypatch.setattr(settings, name, '')
    assert client.get('/api/v1/cctv/cameras').status_code == 401


def test_body_limit_and_validation_do_not_echo_secrets(client):
    result = client.patch('/api/v1/cctv/cameras/cam-1', headers={'X-API-Key': 'write-test'}, json={'secret': 'NEVER'})
    assert result.status_code == 422 and 'NEVER' not in result.text
    result = client.post('/api/v1/auth/verify-2fa', content=b'x' * 70000)
    assert result.status_code == 413


def test_shared_temporary_admin_key_can_read_and_export_but_not_write(monkeypatch):
    from app.core.security import key_principal
    monkeypatch.setattr(settings, 'API_KEYS', 'admin')
    monkeypatch.setattr(settings, 'EXPORT_KEYS', 'admin')
    monkeypatch.setattr(settings, 'WRITE_KEYS', 'separate-write-key')
    principal = key_principal('admin')
    assert principal.scopes == {'read', 'export'}
    assert principal.dashboard is False
    assert key_principal('separate-write-key').scopes == {'read', 'write', 'export'}
