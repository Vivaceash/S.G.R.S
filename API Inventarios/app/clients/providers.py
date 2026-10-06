import asyncio
import json
import ssl
from urllib.parse import urlsplit, parse_qsl
import httpx
from app.core.config import settings
from app.services.inventory import now


class Providers:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=settings.TIMEOUT_SECONDS, follow_redirects=False,
                                       verify=ssl.create_default_context(cafile=settings.CA_BUNDLE), trust_env=False)

    async def fetch(self, provider, endpoint):
        name = provider.upper()
        key = getattr(settings, name + '_KEY')
        mode = getattr(settings, name + '_AUTH_MODE')
        headers = {'X-API-Key': key} if mode == 'api-key' else {'Authorization': 'Bearer ' + key}
        parsed = urlsplit(endpoint)
        params = dict(parse_qsl(parsed.query))
        if provider == 'forti':
            params['vdom'] = settings.FORTI_VDOM
        code, payload = 502, {}
        try:
            async with self.client.stream('GET', getattr(settings, name + '_URL').rstrip('/') + parsed.path, headers=headers, params=params) as response:
                code = response.status_code
                if code == 200:
                    body = bytearray()
                    async for part in response.aiter_bytes():
                        body.extend(part)
                        if len(body) > 8 * 1024 * 1024:
                            raise ValueError('Response too large')
                    payload = json.loads(body)
                    if not isinstance(payload, dict):
                        raise ValueError('Invalid envelope')
        except (httpx.HTTPError, ValueError):
            code, payload = 502, {}
        return {'provider': provider, 'endpoint': endpoint, 'http': code, 'payload': payload, 'observed_at': now()}

    async def collect(self):
        return await asyncio.gather(*(self.fetch(provider, path) for provider, path in (
            ('forti', '/devices?view=operational'), ('forti', '/network/arp-table'),
            ('forti', '/network/dhcp-leases'), ('forti', '/network/interface-config'), ('omni', '/monitoring/devices'))))

    async def close(self):
        await self.client.aclose()
