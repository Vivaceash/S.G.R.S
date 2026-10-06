import asyncio
import httpx
from app.clients.providers import Providers
from app.core.config import settings


def test_provider_preserves_operational_view_and_vdom(store):
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={'success': True, 'data': {'devices': []}})
    async def run():
        provider = Providers()
        await provider.client.aclose()
        provider.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        result = await provider.fetch('forti', '/devices?view=operational')
        await provider.close()
        return result
    result = asyncio.run(run())
    assert result['http'] == 200
    assert seen[0].url.params['view'] == 'operational'
    assert seen[0].url.params['vdom'] == settings.FORTI_VDOM


def test_provider_does_not_reflect_error_body(store):
    async def run():
        provider = Providers()
        await provider.client.aclose()
        provider.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(403, text='secret')))
        result = await provider.fetch('omni', '/monitoring/devices')
        await provider.close()
        return result
    result = asyncio.run(run())
    assert result['http'] == 403 and result['payload'] == {}
