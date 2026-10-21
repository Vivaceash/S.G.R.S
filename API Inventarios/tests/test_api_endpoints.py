import json
from app.core.config import settings

READ = {'X-API-Key': 'read-test'}
WRITE = {'X-API-Key': 'write-test'}


def test_all_cctv_queries_require_credentials_and_health_is_public(client):
    for path in ('catalog', 'cameras', 'summary', 'export', 'cameras/cam-1',
                 'cameras/cam-1/observations', 'cameras/cam-1/changes'):
        assert client.get('/api/v1/cctv/' + path).status_code == 401
    assert client.get('/health').status_code == 200
    assert client.get('/api/v1/system/health').status_code == 200


def test_scalar_and_openapi_are_independent(client, monkeypatch):
    assert client.get('/health').status_code == 200
    assert client.get('/api/v1/system/health').status_code == 200
    assert client.get('/api/v1/cctv/cameras').status_code == 401
    docs = client.get('/docs').text
    assert 'Scalar' in docs
    assert 'persistAuth' in docs
    assert '"withDefaultFonts": false' in docs
    assert client.get('/scalar').status_code == 200
    schema = client.get('/openapi.json').json()
    assert '/api/v1/cctv/cameras/{asset_id}' in schema['paths']
    assert 'APIKeyHeader' in schema['components']['securitySchemes']
    operations = [operation for path in schema['paths'].values() for operation in path.values() if isinstance(operation, dict)]
    assert len(schema['paths']) == 21
    assert len(operations) == 22
    assert all(operation.get('summary') and operation.get('description') for operation in operations)
    assert {tag['name'] for tag in schema['tags']} == {'Salud', 'Autenticación y 2FA', 'CCTV', 'Bitacora', 'Catálogos', 'Fuentes documentales', 'Cotejo de red'}
    assert 'openapi.json' in client.get('/scalar').text
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


def test_idf_reports_are_authenticated_paginated_and_sanitized(client, monkeypatch, tmp_path):
    from app.services import reports
    source = tmp_path / 'reports.json'
    source.write_text(json.dumps({'idf-1': {'incidents': [
        {'id': 'IDF-1', 'date': '2026-10-01', 'severity': 'medium', 'status': 'open',
         'title': 'Revisar cámara', 'description': 'Detalle', 'actor_id': 'private',
         'evidence': 'IDF-private.png'}]}}))
    monkeypatch.setattr(reports, 'REPORTS_FILE', source)
    assert client.get('/api/v1/cctv/reports').status_code == 401
    response = client.get('/api/v1/cctv/reports?idf_id=idf-1&limit=1', headers=READ)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['total'] == 1 and data['items'][0]['idf_id'] == 'idf-1'
    assert 'actor_id' not in response.text and 'evidence' not in response.text
    assert client.get('/api/v1/cctv/reports/idf-1', headers=READ).json()['data']['total'] == 1
    assert client.get('/api/v1/cctv/reports?limit=501', headers=READ).status_code == 422


def test_catalog_exposes_documentary_observations(client):
    data = client.get('/api/v1/cctv/catalog', headers=READ).json()['data']
    assert data['observations'] == [{'idf_id': 'idf-1', 'text': 'Revisar canalización'}]


def test_camera_contract_exposes_documentary_number(client):
    camera = client.get('/api/v1/cctv/cameras/cam-1', headers=READ).json()['data']
    assert camera['number'] == ''
    assert 'number' in client.get('/openapi.json').json()['components']['schemas']['Camera']['properties']


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
