import json
from app.core.config import settings

READ = {'X-API-Key': 'read-test'}
WRITE = {'X-API-Key': 'write-test'}
INTEGRATION = {'X-API-Key': 'integration-test'}


def test_scalar_and_openapi_are_independent(client, monkeypatch):
    assert client.get('/health').status_code == 200
    assert 'Scalar' in client.get('/docs').text
    assert client.get('/scalar').status_code == 200
    schema = client.get('/openapi.json').json()
    assert '/api/v1/cctv/cameras/{asset_id}' in schema['paths']
    assert 'APIKeyHeader' in schema['components']['securitySchemes']
    monkeypatch.setattr(settings, 'ENABLE_DOCS', False)
    assert client.get('/scalar').status_code == 404
    assert client.get('/docs').status_code == 404


def test_auth_fields_pagination_and_export(client):
    assert client.get('/api/v1/cctv/cameras').status_code == 401
    response = client.get('/api/v1/cctv/cameras?limit=1', headers=READ)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['total'] == 1 and data['items'][0]['id'] == 'cam-1'
    assert 'private/files' not in response.text
    assert client.get('/api/v1/cctv/cameras?dataset=cctv_original', headers=READ).json()['data']['total'] == 1
    assert client.get('/api/v1/cctv/export', headers=READ).status_code == 403
    assert client.get('/api/v1/cctv/export', headers={'Authorization': 'Bearer export-test'}).status_code == 200
    assert client.get('/api/v1/cctv/cameras?limit=501', headers=READ).status_code == 422


def test_integration_route_is_read_only_and_limits_sensitive_fields(client):
    url = '/api/v1/cctv/integration/cameras?idf_id=idf-1&limit=1'
    assert client.get(url).status_code == 401
    assert client.get(url, headers=READ).status_code == 403
    response = client.get(url, headers=INTEGRATION)
    assert response.status_code == 200
    item = response.json()['data']['items'][0]
    assert item['id'] == 'cam-1'
    assert item['idf_id'] == 'idf-1'
    assert {'mac', 'serial', 'documented_ip', 'network', 'source', 'documented'}.isdisjoint(item)


def test_corrections_are_versioned_and_historical_read_only(client):
    original = client.get('/api/v1/cctv/cameras/cam-1', headers=READ).json()['data']
    body = {'version': original['version'], 'fields': {'location': 'Pasillo', 'decommissioned': True}}
    assert client.patch('/api/v1/cctv/cameras/cam-1', headers=READ, json=body).status_code == 403
    response = client.patch('/api/v1/cctv/cameras/cam-1', headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    assert response.json()['data']['decommissioned'] is True
    assert response.json()['data']['documented'].get('decommissioned') is None
    assert client.patch('/api/v1/cctv/cameras/cam-1', headers=WRITE, json=body).status_code == 409
    assert client.patch('/api/v1/cctv/cameras/old-1', headers=WRITE, json=body).status_code == 403
    body['fields'] = {'mac': 'wrong'}
    assert client.patch('/api/v1/cctv/cameras/cam-1', headers=WRITE, json=body).status_code == 422
    audit = client.get('/api/v1/cctv/cameras/cam-1/changes', headers=WRITE).json()['data']['items'][0]
    assert audit['changes']['location']['after'] == 'Pasillo'
    assert 'write-test' not in json.dumps(audit)


def test_relocation_requires_destination_and_csv_safe(client):
    row = client.get('/api/v1/cctv/cameras/cam-1', headers=WRITE).json()['data']
    body = {'version': row['version'], 'fields': {'relocated': True}}
    assert client.patch('/api/v1/cctv/cameras/cam-1', headers=WRITE, json=body).status_code == 422
    body['fields'] = {'name': '=FORMULA', 'relocated': True, 'destination': 'Urgencias'}
    assert client.patch('/api/v1/cctv/cameras/cam-1', headers=WRITE, json=body).status_code == 200
    assert "'=FORMULA" in client.get('/api/v1/cctv/export', headers=WRITE).text


def test_service_identity_only_can_delegate_actor(client):
    row = client.get('/api/v1/cctv/cameras/cam-1', headers=WRITE).json()['data']
    client.patch('/api/v1/cctv/cameras/cam-1', headers={**WRITE, 'X-Inventory-Actor': 'spoofed'}, json={'version': row['version'], 'fields': {'location': 'A'}})
    audit = client.get('/api/v1/cctv/cameras/cam-1/changes', headers=WRITE).json()['data']['items'][0]
    assert 'spoofed' not in audit['actor']


def test_missing_catalog_has_clear_503(client):
    from app.repositories.database import database
    with database(write=True) as db:
        db.execute('DELETE FROM catalog')
    assert client.get('/health').status_code == 200
    assert client.get('/api/v1/cctv/cameras', headers=READ).status_code == 503
