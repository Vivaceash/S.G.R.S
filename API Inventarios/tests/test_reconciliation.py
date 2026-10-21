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


def test_periodic_refresh_runs_immediately_and_recovers_next_cycle(monkeypatch):
    import asyncio
    from app.services import reconciliation
    calls = []
    sleeps = []
    reconciler = reconciliation.Reconciler(None)
    def start():
        calls.append('refresh')
        if len(calls) == 1:
            raise RuntimeError('Temporary storage failure')
    async def sleep(seconds):
        assert calls, 'first refresh must run before sleeping'
        sleeps.append(seconds)
        if len(sleeps) == 2:
            raise asyncio.CancelledError()
    monkeypatch.setattr(reconciler, 'start', start)
    monkeypatch.setattr(reconciliation.asyncio, 'sleep', sleep)
    monkeypatch.setattr(reconciliation.settings, 'REFRESH_SECONDS', 60)
    async def run():
        try:
            await reconciler.periodic()
        except asyncio.CancelledError:
            pass
    asyncio.run(run())
    assert calls == ['refresh', 'refresh'] and sleeps == [60, 60]
