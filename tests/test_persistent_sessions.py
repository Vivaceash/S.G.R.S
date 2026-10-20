import json
import sqlite3

import pytest

import dashboard_access as access
from dashboard_routes import AccessRoutes


PASSWORD = 'Persistent-test-2026'


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path / 'private')
    monkeypatch.delenv('SGRS_INITIAL_USER_PASSWORD', raising=False)
    clock = [2_000_000_000]
    monkeypatch.setattr(access.time, 'time', lambda: clock[0])
    root = access.save_user(dict(username='root.test', name='Root Test', role='super-admin', password=PASSWORD), bootstrap=True)
    return root, clock


def user(store, persistent=False, **changes):
    return access.save_user(dict(username='viewer.test', name='Viewer Test', role='viewer', password=PASSWORD,
                                 keep_session=persistent, **changes), store[0]['id'])


def login(username='viewer.test'):
    token, identity = access.login(dict(username=username, password=PASSWORD), '127.0.0.1')
    return f'sgrs_session={token}', identity


def route(cookie, path='/api/auth/session', csrf=None):
    handler = AccessRoutes()
    handler.headers = {'Cookie': cookie, 'X-CSRF-Token': csrf or ''}
    handler.path = path
    handler._boundary = lambda **kwargs: None
    handler._secure_transport = lambda: True
    handler._send_json = lambda payload, status=200: setattr(handler, 'response', payload)
    return handler


def test_persistent_survives_idle_cleanup_and_eight_hours_and_renews_cookie(store):
    account = user(store, True)
    cookie, identity = login()
    assert identity['user']['keep_session'] is True
    store[1][0] += access.IDLE_SECONDS + 1
    login('root.test')  # Login cleanup must not remove persistent sessions.
    assert access.session(cookie)
    store[1][0] += access.SESSION_SECONDS + 1
    handler = route(cookie)
    assert handler.access_get()
    assert handler.response['user']['id'] == account['id']
    assert 'token_hash' not in handler.response
    assert f'Max-Age={access.PERSISTENT_SESSION_SECONDS}' in handler._session_cookie
    assert '; Secure' in handler._session_cookie
    assert '; HttpOnly' in handler._session_cookie
    with access.database() as db:
        expires = db.execute('SELECT expires FROM sessions WHERE user_id=?', (account['id'],)).fetchone()[0]
    assert expires == store[1][0] + access.PERSISTENT_SESSION_SECONDS
    store[1][0] += access.PERSISTENT_SESSION_SECONDS
    assert access.session(cookie) is None


def test_normal_sessions_keep_idle_and_absolute_expiration(store):
    account = user(store)
    cookie, _ = login()
    store[1][0] += access.IDLE_SECONDS
    assert access.session(cookie) is None
    cookie, _ = login()
    for _ in range(16):
        store[1][0] += 1700
        assert access.session(cookie)
    store[1][0] += 1700
    assert access.session(cookie) is None
    assert account['keep_session'] is False


@pytest.mark.parametrize('persistent', [False, True])
def test_login_sets_matching_cookie_lifetime(store, persistent):
    user(store, persistent)
    handler = route('', '/api/auth/login')
    handler.client_address = ('127.0.0.1', 1234)
    handler._body = lambda: dict(username='viewer.test', password=PASSWORD)
    assert handler.access_post()
    duration = access.PERSISTENT_SESSION_SECONDS if persistent else access.SESSION_SECONDS
    assert f'Max-Age={duration};' in handler._session_cookie
    assert handler.response['user']['keep_session'] is persistent


@pytest.mark.parametrize('changes', [{'keep_session': False}, {'active': False}, {'password': 'Replacement-test-2026'}])
def test_editing_or_disabling_revokes_persistent_session(store, changes):
    account = user(store, True)
    cookie, _ = login()
    access.save_user({**account, **changes}, store[0]['id'])
    assert access.session(cookie) is None


def test_logout_deletes_persistent_session_and_cookie(store):
    user(store, True)
    cookie, identity = login()
    handler = route(cookie, '/api/auth/logout', identity['csrf'])
    handler.client_address = ('127.0.0.1', 1234)
    assert handler.access_post()
    assert handler.response == {'status': 'success'}
    assert 'Max-Age=0' in handler._session_cookie
    assert access.session(cookie) is None


def test_setting_is_preserved_validated_and_audited(store):
    account = user(store, True)
    saved = access.save_user({k: v for k, v in account.items() if k != 'keep_session'}, store[0]['id'])
    assert saved['keep_session'] is True
    saved = access.save_user({**saved, 'keep_session': False}, store[0]['id'])
    with access.database() as db:
        event = db.execute("SELECT details FROM audit WHERE action='user.updated' ORDER BY id DESC").fetchone()
    assert json.loads(event[0])['after']['keep_session'] is False
    with pytest.raises(access.AccessError) as error:
        access.save_user({**saved, 'keep_session': 'true'}, store[0]['id'])
    assert error.value.status == 422
    with pytest.raises(access.AccessError) as error:
        access.save_user({**saved, 'keep_session': True}, saved['id'])
    assert error.value.status == 403


def test_existing_database_migrates_with_setting_disabled(store):
    # Recreate the preceding schema without the new column, preserving its rows.
    with sqlite3.connect(access.PRIVATE / 'dashboard.sqlite3') as db:
        db.execute('ALTER TABLE users DROP COLUMN keep_session')
    with access.database() as db:
        row = db.execute('SELECT * FROM users WHERE id=?', (store[0]['id'],)).fetchone()
    assert row['keep_session'] == 0
    assert access.public_user(row)['keep_session'] is False
