"""Prepara claves aleatorias locales y conecta, si están configuradas, los proveedores SGRS."""
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
from dotenv import dotenv_values
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dashboard_access


def atomic_private(path, content):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.inventory-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.chmod(name, 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    private = Path(__file__).resolve().parents[1] / '.private'
    service_env = private / '.env'
    shared = dashboard_access.PRIVATE / 'inventarios-connection.json'
    try:
        # Read both supported files before provisioning: existing keys must never
        # be replaced merely because the private file has not been created yet.
        old_env = {
            **dotenv_values(private.parent / '.env', interpolate=False),
            **dotenv_values(service_env, interpolate=False),
        }
        old_env = {key: value for key, value in old_env.items() if value is not None}
        dashboard_key = old_env.get('INVENTARIOS_DASHBOARD_KEY') or secrets.token_urlsafe(48)
        read_key = old_env.get('INVENTARIOS_API_KEYS') or secrets.token_urlsafe(48)
        write_key = old_env.get('INVENTARIOS_WRITE_KEYS') or secrets.token_urlsafe(48)
        export_key = old_env.get('INVENTARIOS_EXPORT_KEYS') or secrets.token_urlsafe(48)
        forti = dashboard_access.connection('forti')
        omni = dashboard_access.connection('omni')
        def provider(value):
            mode = 'bearer' if value['auth_mode'] == 'bearer' else 'api-key'
            return value['url'], value['secret'], mode
        forti_url, forti_key, forti_mode = provider(forti)
        omni_url, omni_key, omni_mode = provider(omni)
        values = {
            **old_env,
            'INVENTARIOS_HOST': old_env.get('INVENTARIOS_HOST', '127.0.0.1'),
            'INVENTARIOS_PORT': old_env.get('INVENTARIOS_PORT', '8002'),
            'INVENTARIOS_ENVIRONMENT': old_env.get('INVENTARIOS_ENVIRONMENT', 'development'),
            'INVENTARIOS_ENABLE_DOCS': old_env.get('INVENTARIOS_ENABLE_DOCS', 'true'),
            'INVENTARIOS_API_KEYS': read_key, 'INVENTARIOS_WRITE_KEYS': write_key,
            'INVENTARIOS_EXPORT_KEYS': export_key, 'INVENTARIOS_DASHBOARD_KEY': dashboard_key,
            'INVENTARIOS_FORTI_URL': old_env.get('INVENTARIOS_FORTI_URL', forti_url), 'INVENTARIOS_FORTI_KEY': old_env.get('INVENTARIOS_FORTI_KEY', forti_key),
            'INVENTARIOS_FORTI_AUTH_MODE': old_env.get('INVENTARIOS_FORTI_AUTH_MODE', forti_mode), 'INVENTARIOS_FORTI_VDOM': old_env.get('INVENTARIOS_FORTI_VDOM', 'root'),
            'INVENTARIOS_OMNI_URL': old_env.get('INVENTARIOS_OMNI_URL', omni_url), 'INVENTARIOS_OMNI_KEY': old_env.get('INVENTARIOS_OMNI_KEY', omni_key),
            'INVENTARIOS_OMNI_AUTH_MODE': old_env.get('INVENTARIOS_OMNI_AUTH_MODE', omni_mode),
            'INVENTARIOS_STALE_SECONDS': old_env.get('INVENTARIOS_STALE_SECONDS', '120'),
            'INVENTARIOS_REFRESH_SECONDS': old_env.get('INVENTARIOS_REFRESH_SECONDS', '0'),
            'INVENTARIOS_RETENTION_DAYS': old_env.get('INVENTARIOS_RETENTION_DAYS', '90'),
        }
        atomic_private(service_env, ''.join(f'{key}={json.dumps(value, ensure_ascii=False)}\n' for key, value in values.items()))
        local_url = f"http://127.0.0.1:{values['INVENTARIOS_PORT']}/api/v1"
        # Provision defaults only. Saved dashboard connections and their keys
        # belong to the administrator and must not be synchronized at startup.
        if not shared.exists():
            atomic_private(shared, json.dumps({'url': local_url, 'secret': dashboard_key}))
        print('API Inventarios: claves internas listas (se conservan las existentes). Conexión con Forti:', 'disponible' if forti_key else 'por configurar',
              '· Conexión con Omni:', 'disponible' if omni_key else 'por configurar')
    except Exception as exc:
        raise SystemExit('No se pudo preparar API Inventarios: ' + type(exc).__name__) from None


if __name__ == '__main__':
    main()
