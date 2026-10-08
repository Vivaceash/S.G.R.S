"""Dashboard boundary for the independent inventory service; secrets stay server-side."""
import json
from pathlib import Path
import time
from urllib.parse import quote
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
                    # Provider credentials belong to this backend, not the user's
                    # dashboard session. A forwarded 401 would trigger a login loop.
                    status = response.status_code if response.status_code in messages else 503
                    if status in (401, 403):
                        status = 502
                    raise access.AccessError(status,
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
    value = request('/cctv/catalog')
    return {**value, 'observations': value.get('observations', [])}


def reconcile(actor=None, timeout=12.0, poll_interval=0.1):
    """Run the persisted Inventarios reconciliation and return its result."""
    started = request('/reconciliation/jobs', 'POST', {}, actor)
    job_id = started.get('id') if isinstance(started, dict) else None
    if not job_id:
        raise access.AccessError(503, 'API Inventarios no devolvió un cotejo válido.')

    deadline = time.monotonic() + timeout
    while True:
        current = request('/reconciliation/jobs/' + quote(str(job_id), safe=''))
        status = current.get('status') if isinstance(current, dict) else None
        if status in ('completed', 'partial'):
            result = current.get('result')
            if isinstance(result, dict):
                return result
            raise access.AccessError(503, 'API Inventarios terminó sin devolver el resultado del cotejo.')
        if status == 'failed':
            raise access.AccessError(503, 'API Inventarios no pudo completar el cotejo.')
        if status not in ('queued', 'running'):
            raise access.AccessError(503, 'API Inventarios devolvió un estado de cotejo desconocido.')
        if time.monotonic() >= deadline:
            raise access.AccessError(504, 'El cotejo de Inventarios tardó demasiado. Vuelve a intentarlo.')
        time.sleep(poll_interval)


def save(body, actor):
    asset_id = body.get('id', '')
    from urllib.parse import quote
    return {'asset': request('/cctv/cameras/' + quote(asset_id, safe=''), 'PATCH',
                             {'version': body.get('version'), 'fields': body.get('fields')}, actor)}
