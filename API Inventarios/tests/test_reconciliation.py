import time
from app.clients.providers import Providers
from conftest import responses


def test_job_persists_observations_without_contacting_providers(client, monkeypatch):
    async def collect(self):
        return responses()
    monkeypatch.setattr(Providers, 'collect', collect)
    assert client.post('/api/v1/reconciliation/jobs', headers={'X-API-Key': 'read-test'}).status_code == 403
    headers = {'X-API-Key': 'write-test'}
    result = client.post('/api/v1/reconciliation/jobs', headers=headers)
    assert result.status_code == 202
    identifier = result.json()['data']['id']
    for _ in range(30):
        job = client.get('/api/v1/reconciliation/jobs/' + identifier, headers=headers).json()['data']
        if job['status'] not in ('queued', 'running'):
            break
        time.sleep(.01)
    assert job['status'] == 'completed', job
    camera = client.get('/api/v1/cctv/cameras/cam-1', headers=headers).json()['data']
    assert camera['network']['vlan']['vlan_id'] == 222
    assert camera['network']['stale'] is False
    assert client.get('/api/v1/cctv/cameras/cam-1/observations', headers=headers).json()['data']['total'] == 1
