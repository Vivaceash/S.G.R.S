import importlib.util
import os
from pathlib import Path
import shutil
import pytest
from pydantic import ValidationError


def configure_module():
    path = Path(__file__).resolve().parents[1] / 'scripts/configure_local.py'
    spec = importlib.util.spec_from_file_location('inventory_configure_local', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_env_overrides_legacy_env_and_environment_remains_highest_priority(tmp_path, monkeypatch):
    from app.core import config

    for name in tuple(os.environ):
        if name.startswith('INVENTARIOS_'):
            monkeypatch.delenv(name)
    core = tmp_path / 'app/core'
    core.mkdir(parents=True)
    source = core / 'config.py'
    shutil.copyfile(config.__file__, source)
    private = tmp_path / '.private'
    private.mkdir()
    (tmp_path / '.env').write_text(
        'INVENTARIOS_API_KEYS=legacy-short-key\n'
        'INVENTARIOS_DEBUG=true\n'
        'INVENTARIOS_ALLOWED_HOSTS=["*"]\n'
    )
    (private / '.env').write_text(
        'INVENTARIOS_ENVIRONMENT=production\n'
        'INVENTARIOS_API_KEYS=' + 'r' * 43 + '\n'
        'INVENTARIOS_DEBUG=false\n'
        'INVENTARIOS_ALLOWED_HOSTS=["localhost","127.0.0.1"]\n'
    )
    spec = importlib.util.spec_from_file_location('inventory_private_env_probe', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.settings.API_KEYS == 'r' * 43
    assert module.settings.DEBUG is False
    assert '*' not in module.settings.ALLOWED_HOSTS
    monkeypatch.setenv('INVENTARIOS_API_KEYS', 'env-operator-key-' * 3)
    assert module.Settings().API_KEYS == 'env-operator-key-' * 3


def production_settings(**overrides):
    from app.core.config import Settings
    return Settings(
        _env_file=None, ENVIRONMENT='production',
        API_KEYS='a', WRITE_KEYS='w', EXPORT_KEYS='e', DASHBOARD_KEY='d',
        **overrides,
    )


def test_production_accepts_api_keys_without_minimum_length():
    settings = production_settings()
    assert settings.api_keys == ['a']
    assert settings.WRITE_KEYS == 'w'
    assert settings.EXPORT_KEYS == 'e'
    assert settings.DASHBOARD_KEY == 'd'


@pytest.mark.parametrize('overrides,field', [
    ({'DEBUG': True}, 'INVENTARIOS_DEBUG'),
    ({'ALLOWED_HOSTS': ['*']}, 'INVENTARIOS_ALLOWED_HOSTS'),
    ({'CORS_ORIGINS': ['*']}, 'INVENTARIOS_CORS_ORIGINS'),
])
def test_production_validation_names_invalid_setting_without_disclosing_keys(overrides, field):
    with pytest.raises(ValidationError) as error:
        production_settings(**overrides)
    assert field in str(error.value)
    assert 'input_value' not in str(error.value)


def test_production_still_requires_an_authentication_key():
    from app.core.config import Settings
    with pytest.raises(ValidationError, match='requiere al menos una clave'):
        Settings(_env_file=None, ENVIRONMENT='production')


def test_private_configuration_can_be_written_without_fchmod(tmp_path, monkeypatch):
    module = configure_module()
    monkeypatch.delattr(module.os, 'fchmod', raising=False)
    target = tmp_path / '.private/.env'
    module.atomic_private(target, 'TEST_SETTING=example\n')
    assert target.read_text() == 'TEST_SETTING=example\n'


def test_provider_refresh_preserves_production_settings_and_inventory_keys(tmp_path, monkeypatch):
    module = configure_module()
    service = tmp_path / 'API Inventarios'
    private = service / '.private'
    private.mkdir(parents=True)
    env = private / '.env'
    existing = {
        'INVENTARIOS_ENVIRONMENT': 'production',
        'INVENTARIOS_HOST': '0.0.0.0',
        'INVENTARIOS_DEBUG': 'false',
        'INVENTARIOS_ALLOWED_HOSTS': '["localhost","127.0.0.1"]',
        'INVENTARIOS_CORS_ORIGINS': '["http://localhost:3000"]',
        'INVENTARIOS_API_KEYS': 'r' * 43,
        'INVENTARIOS_WRITE_KEYS': 'w' * 43,
        'INVENTARIOS_EXPORT_KEYS': 'e' * 43,
        'INVENTARIOS_DASHBOARD_KEY': 'd' * 43,
        'INVENTARIOS_JWT_SECRET_KEY': 'j' * 43,
    }
    env.write_text(''.join(f'{key}={value}\n' for key, value in existing.items()))
    monkeypatch.setattr(module, '__file__', str(service / 'scripts/configure_local.py'))
    monkeypatch.setattr(module.dashboard_access, 'PRIVATE', tmp_path / '.sgrs-private')
    monkeypatch.setattr(module.dashboard_access, 'connection', lambda name: {
        'url': f'http://127.0.0.1:{8001 if name == "forti" else 8000}/api/v1',
        'auth_mode': 'api-key', 'secret': f'new-{name}-gateway-key',
    })

    module.main()

    updated = dict(line.split('=', 1) for line in env.read_text().splitlines())
    for key, value in existing.items():
        assert updated[key] == value
    assert updated['INVENTARIOS_FORTI_KEY'] == 'new-forti-gateway-key'
    assert updated['INVENTARIOS_OMNI_KEY'] == 'new-omni-gateway-key'


@pytest.mark.parametrize('url,expected', [('http://127.0.0.1:8002/api/v1', 'd' * 43), ('https://inventory.example/api/v1', 'saved-key')])
def test_provisioning_synchronizes_only_managed_local_dashboard_connection(tmp_path, monkeypatch, url, expected):
    module = configure_module()
    service = tmp_path / 'API Inventarios'
    private = service / '.private'
    private.mkdir(parents=True)
    (private / '.env').write_text('INVENTARIOS_DASHBOARD_KEY=' + 'd' * 43 + '\n')
    monkeypatch.setattr(module, '__file__', str(service / 'scripts/configure_local.py'))
    access = module.dashboard_access
    monkeypatch.setattr(access, 'PRIVATE', tmp_path / '.sgrs-private')
    with access.database(write=True) as db:
        db.execute('INSERT INTO connections VALUES(?,?,?,?,?,?,?)', ('inventarios', url, 'api-key', '', 'saved-key', 3, 0))
    module.main()
    value = access.connection('inventarios')
    assert value['secret'] == expected
    assert value['version'] == (4 if url.startswith('http://127.0.0.1:') else 3)
    env = dict(line.split('=', 1) for line in (private / '.env').read_text().splitlines())
    assert env['INVENTARIOS_REFRESH_SECONDS'] == '0'
