import copy
import json
from pathlib import Path
import zipfile

import pytest

import dashboard_access as access
import dashboard_inventory as inventory
from dashboard_reports import ReportRoutes, report_key, tagged_reports
from scripts.import_documentary_inventory import sheets, tables


def asset(identifier='camera', **extra):
    return {'id': identifier, 'dataset': 'cctv', 'kind': 'equipment', 'name': 'Cámara',
            'idf_id': 'idf-1', 'mac': 'AA:BB:CC:DD:EE:01', 'serial': 'CAM-1',
            'documented_ip': '192.0.2.10', 'location': 'Pasillo', 'relocated': False,
            'destination': '', 'issues': [], **extra}


def response(provider='forti', rows=None, http=200):
    rows = [] if rows is None else rows
    return {'provider': provider, 'http': http, 'observed_at': '2026-09-17T12:00:00Z',
            'payload': {'success': True, 'data': {'devices': rows} if provider == 'forti' else rows}}


def test_api_identity_wins_ip_but_preserves_documented_values():
    original = asset()
    result = inventory.reconcile([original], [response(rows=[{'mac': original['mac'], 'ip': '192.0.2.20', 'is_online': True, 'secret': 'must-not-escape'}]), response('omni')])
    observed = result['assets']['camera']
    assert observed['comparison'] == 'changed'
    assert observed['ip'] == '192.0.2.20'
    assert observed['status'] == 'online'
    assert original['documented_ip'] == '192.0.2.10'
    assert 'must-not-escape' not in json.dumps(result)


def test_same_ip_is_not_identity_and_absence_is_not_offline():
    result = inventory.reconcile([asset()], [response(rows=[{'ip': '192.0.2.10', 'mac': 'AA:BB:CC:DD:EE:02', 'is_online': True}]), response('omni')])
    assert result['assets']['camera']['comparison'] == 'not_observed'
    assert result['assets']['camera']['status'] == 'unknown'
    assert result['assets']['camera']['ip'] == ''
    assert len(result['only_api']) == 1


def test_unavailable_and_unrecognized_shape_are_not_empty_success():
    invalid = response('omni')
    invalid['payload']['data'] = {'unexpected': []}
    result = inventory.reconcile([asset()], [response(http=502), invalid])
    assert result['assets']['camera']['comparison'] == 'unavailable'
    assert all(not s['available'] and s['count'] is None for s in result['sources'])


def test_duplicate_documentary_identity_and_provider_ambiguity_are_not_linked():
    rows = [asset(), asset('other')]
    result = inventory.reconcile(rows, [response(rows=[{'mac': rows[0]['mac'], 'ip': '192.0.2.10'}])])
    assert all(r['comparison'] == 'ambiguous' and r['ip'] == '' for r in result['assets'].values())
    result = inventory.reconcile([asset()], [response(rows=[{'mac': asset()['mac']}, {'mac': asset()['mac']}])])
    assert result['assets']['camera']['comparison'] == 'ambiguous'


def test_provider_disagreement_never_selects_an_arbitrary_current_ip():
    result = inventory.reconcile([asset()], [response(rows=[{'mac': asset()['mac'], 'ip': '192.0.2.10', 'is_online': True}]), response('omni', [{'macAddress': asset()['mac'], 'ipAddress': '192.0.2.11', 'status': 'Up'}])])
    assert result['assets']['camera']['comparison'] == 'ambiguous'
    assert result['assets']['camera']['ip'] == ''
    assert len(result['assets']['camera']['observations']) == 2


def test_matching_mac_with_conflicting_serial_is_ambiguous():
    result = inventory.reconcile([asset()], [response('omni', [{'mac': asset()['mac'], 'serialNumber': 'OTHER'}])])
    assert result['assets']['camera']['comparison'] == 'ambiguous'


def test_history_and_racks_do_not_duplicate_current_identity():
    result = inventory.reconcile([asset(), asset('old', dataset='cctv_original'), asset('rack', kind='rack')], [response(rows=[{'mac': asset()['mac'], 'ip': '192.0.2.10'}])])
    assert list(result['assets']) == ['camera']
    assert result['assets']['camera']['comparison'] == 'matched'


@pytest.mark.parametrize('path', ['/api/inventory/asset', '/api/reports/resolve', '/api/inventory/documents/abc'])
@pytest.mark.parametrize('identity_kind', ['anonymous', 'viewer', 'admin_without_csrf'])
def test_inventory_boundary_rejects_unauthorized_requests(monkeypatch, path, identity_kind):
    from dashboard_routes import AccessRoutes
    import dashboard_routes

    class Boundary(AccessRoutes):
        def _boundary(self, mutation=False):
            pass

        def _send_json(self, payload, status=200):
            self.response = status, payload

    role = 'viewer' if identity_kind == 'viewer' else 'admin'
    identity = None if identity_kind == 'anonymous' else {
        'user': {'id': 'test', 'role': role}, 'csrf': 'valid', 'capabilities': access.capabilities(role)}
    monkeypatch.setattr(dashboard_routes, 'session', lambda cookie: identity)
    handler = Boundary()
    handler.path = path
    handler.headers = {'Cookie': 'test', 'X-CSRF-Token': 'valid' if identity_kind == 'viewer' else ''}
    if '/documents/' in path:
        if identity_kind == 'admin_without_csrf':
            return  # GET is not a mutation; CSRF is intentionally not required.
        handler.access_get()
    else:
        handler.access_post()
    assert handler.response[0] == (401 if identity_kind == 'anonymous' else 403)


def test_download_blocks_encrypted_source_and_changed_original(documentary_store, tmp_path):
    import hashlib
    data = documentary_store
    data['source_directory'] = str(tmp_path)
    raw = b'original-test-document'
    digest = hashlib.sha256(raw).hexdigest()
    data['sources'] = [{'file': 'Estructura.xlsm', 'sha256': 'encrypted'},
                       {'file': 'CheckList CCTV.xlsx', 'sha256': digest}]
    (tmp_path / 'documentary.json').write_text(json.dumps(data))
    with pytest.raises(access.AccessError) as error:
        inventory.source_download('encrypted')
    assert error.value.status == 404
    (tmp_path / 'CheckList CCTV.xlsx').write_bytes(raw)
    assert inventory.source_download(digest)[0] == raw
    (tmp_path / 'CheckList CCTV.xlsx').write_bytes(b'changed')
    with pytest.raises(access.AccessError) as error:
        inventory.source_download(digest)
    assert error.value.status == 409


@pytest.fixture
def documentary_store(tmp_path, monkeypatch):
    monkeypatch.setattr(access, 'PRIVATE', tmp_path)
    data = {'schema_version': 1, 'assets': [asset(), asset('old', dataset='cctv_original')],
            'cabinets': [{'id': 'idf-1', 'name': 'IDF 1'}, {'id': 'idf-13', 'name': 'IDF 13'}],
            'sources': [], 'observations': [], 'source_directory': '/private/originals'}
    (tmp_path / 'documentary.json').write_text(json.dumps(data))
    return data


def test_physical_correction_preserves_source_and_detects_conflicts(documentary_store):
    before = inventory.catalog()
    original = before['assets'][0]
    saved = inventory.save_asset({'id': original['id'], 'version': original['version'], 'fields': {'location': 'Nueva ubicación'}}, 'operator')['asset']
    assert saved['location'] == 'Nueva ubicación'
    assert saved['documented']['location'] == 'Pasillo'
    assert 'source_directory' not in before
    with pytest.raises(access.AccessError) as error:
        inventory.save_asset({'id': original['id'], 'version': original['version'], 'fields': {'location': 'Obsoleta'}}, 'operator')
    assert error.value.status == 409
    assert inventory.catalog()['assets'][0]['location'] == 'Nueva ubicación'
    with access.database() as db:
        assert db.execute('SELECT action FROM audit').fetchone()[0] == 'inventory.physical.update'


def test_live_adapter_uses_only_read_contracts_and_marks_transport_failure(documentary_store):
    calls = []

    def fetch(provider, endpoint):
        calls.append((provider, endpoint))
        if provider == 'omni':
            raise TimeoutError('private upstream details must not escape')
        payload = response(rows=[{'mac': asset()['mac'], 'ip': '192.0.2.20', 'is_online': True}])['payload']
        return 200, json.dumps(payload).encode(), 'application/json'

    result = inventory.live_reconciliation(fetch)
    assert set(calls) == {('forti', '/devices?view=operational'), ('omni', '/monitoring/devices')}
    assert result['assets']['camera']['ip'] == '192.0.2.20'
    assert result['assets']['camera']['comparison'] == 'changed'
    assert result['revision'] == inventory.catalog()['revision']
    omni = next(s for s in result['sources'] if s['provider'] == 'omni')
    assert omni['available'] is False and omni['http'] == 502 and omni['count'] is None
    assert all(s['observed_at'] for s in result['sources'])
    assert 'private upstream' not in json.dumps(result)


def test_viewer_projection_redacts_nested_documentary_and_api_identity(documentary_store):
    from dashboard_routes import AccessRoutes
    handler = AccessRoutes()
    handler.identity = {'user': {'role': 'viewer'}}
    result = handler.viewer_projection(inventory.catalog())
    for row in result['assets']:
        assert 'mac' not in row and 'serial' not in row
        assert 'mac' not in row['documented'] and 'serial' not in row['documented']
    assert 'source_directory' not in result


@pytest.mark.parametrize('fields', [{'status': 'online'}, {'documented_ip': '192.0.2.88'}, {'idf_id': 'idf-pacs'}, {'relocated': True, 'destination': ''}, {'name': ''}])
def test_untrusted_physical_mutations_are_rejected(documentary_store, fields):
    current = inventory.catalog()['assets'][0]
    with pytest.raises(access.AccessError) as error:
        inventory.save_asset({'id': current['id'], 'version': current['version'], 'fields': fields}, 'operator')
    assert error.value.status == 422


def test_historical_catalog_is_immutable_and_pacs_is_not_merged(documentary_store):
    old = inventory.catalog()['assets'][1]
    with pytest.raises(access.AccessError) as error:
        inventory.save_asset({'id': old['id'], 'version': old['version'], 'fields': {'location': 'Changed'}}, 'operator')
    assert error.value.status == 403
    local = [{'id': 'idf-pacs', 'devices': [{'serial': 'keep'}]}]
    merged = inventory.cabinets_with_documentary(local)
    assert merged[0] == local[0]
    assert {r['id'] for r in merged} == {'idf-pacs', 'idf-1'}


def test_resolve_historical_report_retains_evidence_and_detects_stale_write(tmp_path):
    import threading
    original = {'id': 'historic-1', 'description': 'UPS alarmada', 'status': 'open', 'evidence': 'test.jpg'}
    reports = tmp_path / 'reports.json'
    idfs = tmp_path / 'idfs.json'
    reports.write_text('{}')
    idfs.write_text(json.dumps([{'id': 'idf-1', 'incidents': [original]}]))
    class Handler(ReportRoutes):
        identity = {'user': {'id': 'operator'}}
        def report_context(self):
            return reports, idfs, threading.Lock()
        def _send_json(self, body):
            self.sent = body
    handler = Handler()
    body = {'idf_id': 'idf-1', 'record_key': report_key(original)}
    handler.resolve_report(body)
    saved = handler.sent['incident']
    assert saved['status'] == 'resolved' and saved['evidence'] == 'test.jpg'
    assert saved['description'] == original['description']
    assert saved['resolved_by'] == 'operator'
    assert json.loads(idfs.read_text())[0]['incidents'][0]['status'] == 'open'
    with pytest.raises(access.AccessError) as error:
        handler.resolve_report(body)
    assert error.value.status == 409
    assert tagged_reports({'idf-1': [original]})['idf-1'][0]['record_key'] == body['record_key']


def test_reader_resolves_shared_strings_and_boolean_cells(tmp_path):
    path = tmp_path / 'book.xlsx'
    with zipfile.ZipFile(path, 'w') as package:
        package.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" r:id="r1"/></sheets></workbook>')
        package.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        package.writestr('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>A11</t></si></sst>')
        package.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5"><c r="D5" t="s"><v>0</v></c><c r="H5" t="b"><v>0</v></c><c r="I5" t="inlineStr"><is><t>Destino</t></is></c></row></sheetData></worksheet>')
    assert sheets(path)['Hoja1'] == [{'row': 5, 'D': 'A11', 'H': False, 'I': 'Destino'}]


def test_word_reader_does_not_count_nested_tables_as_cabinets(tmp_path):
    path = tmp_path / 'doc.docx'
    with zipfile.ZipFile(path, 'w') as package:
        package.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>IDF-1</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Observación embebida</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl></w:body></w:document>')
    result = tables(path)
    assert len(result) == 1
    assert 'Observación embebida' in result[0][0][0]
