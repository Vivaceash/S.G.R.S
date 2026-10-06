import asyncio
import pytest
from fastapi import HTTPException
from app.routers.network import get_interface_config
from app.clients.fortios import fortios_client


def test_interface_config_allowlist_and_actual_mask(monkeypatch):
    calls = []
    async def request(*args, **kwargs):
        calls.append((args, kwargs))
        return {'vdom': 'root', 'results': [{'name': 'CCTV', 'type': 'vlan', 'vlanid': 222, 'interface': 'port3', 'ip': '192.168.98.1 255.255.254.0',
                                            'secondary-IP': 'enable', 'secondaryip': [{'ip': '10.0.0.1 255.255.255.0'}], 'password': 'NEVER'}]}
    monkeypatch.setattr(fortios_client, 'request', request)
    result = asyncio.run(get_interface_config('root'))
    row = result.data[0]
    assert row.vlan_id == 222 and row.subnets == ['10.0.0.0/24', '192.168.98.0/23']
    assert 'NEVER' not in result.model_dump_json()
    assert calls[0][0][1] == 'api/v2/cmdb/system/interface'
    assert calls[0][1]['vdom'] == 'root'


@pytest.mark.parametrize('payload', [{'results': {}}, {'results': [], 'limit_reached': True}, {'results': [{'name': 'CCTV', 'vdom': 'other'}]}])
def test_invalid_or_partial_configuration_is_not_empty_success(monkeypatch, payload):
    async def request(*args, **kwargs):
        return payload
    monkeypatch.setattr(fortios_client, 'request', request)
    with pytest.raises(HTTPException) as error:
        asyncio.run(get_interface_config('root'))
    assert error.value.status_code == 502
