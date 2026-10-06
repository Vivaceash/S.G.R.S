import copy
import json
from app.services.inventory import snapshot
from app.services.network_enrichment import enrich, associate_network
from conftest import responses


def test_real_vlan_not_ip_octet_and_no_secrets(store):
    result = enrich(snapshot()['assets'], responses())
    observed = result['assets']['cam-1']
    assert observed['status'] == 'online'
    assert observed['vlan']['vlan_id'] == 222
    assert observed['vlan']['subnets'] == ['192.168.98.0/23']
    assert observed['observations'][0]['last_seen'] == 123
    assert 'NEVER' not in json.dumps(result)
    assert 'old-1' not in result['assets']


def test_arp_static_camera_does_not_claim_liveness(store):
    rows = responses()
    rows[0]['payload']['data']['devices'] = []
    rows[1]['payload']['data'] = [{'mac': 'AA:BB:CC:DD:EE:01', 'ip': '192.168.99.25', 'interface': 'cameras', 'state': 'reachable'}]
    result = enrich(snapshot()['assets'], rows)['assets']['cam-1']
    assert result['comparison'] == 'changed'
    assert result['ip'] == '192.168.99.25' and result['status'] == 'unknown'
    assert result['vlan']['vlan_id'] == 222


def test_conflicting_sources_do_not_choose_ip(store):
    rows = responses()
    rows[1]['payload']['data'] = [{'mac': 'AA:BB:CC:DD:EE:01', 'ip': '192.168.99.100'}]
    value = enrich(snapshot()['assets'], rows)['assets']['cam-1']
    assert value['comparison'] == 'ambiguous' and value['ip'] == ''


def test_failed_provider_and_absence_are_distinct(store):
    rows = responses()
    rows[0]['payload']['data']['devices'] = []
    result = enrich(snapshot()['assets'], rows)
    assert result['assets']['cam-1']['comparison'] == 'not_observed'
    rows[0]['http'] = 502
    result = enrich(snapshot()['assets'], rows)
    assert result['partial'] and result['assets']['cam-1']['comparison'] == 'unavailable'


def test_ambiguous_subnets_and_interface_precedence():
    first = responses()[3]['payload']['data'][0]
    second = {**first, 'name': 'other', 'vlan_id': 12}
    assert associate_network('192.168.99.4', '', [first, second])['association'] == 'ambiguous'
    assert associate_network('192.168.99.4', 'cameras', [first, second])['vlan_id'] == 222


def test_duplicate_mac_does_not_join(store):
    assets = snapshot()['assets']
    assets.append({**assets[0], 'id': 'duplicate'})
    assert enrich(assets, responses())['assets']['cam-1']['comparison'] == 'ambiguous'
