"""Dashboard boundary for the independent inventory service; secrets stay server-side."""
import json
from pathlib import Path
import httpx
import dashboard_access as access


def active():
    return (access.PRIVATE / 'inventarios-active.json').exists()


def request(path, method='GET', body=None, actor=None, binary=False):
    config = access.connection('inventarios')
    headers = access.connection_headers(config)
    if actor:
        headers['X-Inventory-Actor'] = actor
    try:
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            with client.stream(method, config['url'].rstrip('/') + path, headers=headers, json=body) as response:
                raw = bytearray()
                for part in response.iter_bytes():
                    raw.extend(part)
                    if len(raw) > 16 * 1024 * 1024:
                        raise ValueError('Response too large')
                if response.status_code >= 300:
                    messages = {401: 'Configura la credencial de API Inventarios.', 403: 'La credencial no permite esta operación.',
                                404: 'Recurso de inventario no encontrado.', 409: 'El inventario cambió. Actualiza la ficha conservando tus cambios.',
                                422: 'Revisa los campos, gabinete y destino de reubicación.'}
                    raise access.AccessError(response.status_code if response.status_code in messages else 503,
                                             messages.get(response.status_code, 'API Inventarios no está disponible.'))
                if binary:
                    return bytes(raw), response.headers.get('content-type', 'application/octet-stream')
                value = json.loads(raw)
                if not isinstance(value, dict) or value.get('success') is not True or 'data' not in value:
                    raise ValueError('Invalid envelope')
                return value['data']
    except (httpx.HTTPError, ValueError):
        raise access.AccessError(503, 'API Inventarios no está disponible. Revisa su servicio y conexión.') from None


def catalog():
    return {**request('/cctv/catalog'), 'observations': []}


def save(body, actor):
    asset_id = body.get('id', '')
    from urllib.parse import quote
    return {'asset': request('/cctv/cameras/' + quote(asset_id, safe=''), 'PATCH',
                             {'version': body.get('version'), 'fields': body.get('fields')}, actor)}
