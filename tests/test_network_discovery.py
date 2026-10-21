import json
import pytest
from dashboard_access import AccessError
from dashboard_networks import SOURCES, catalog


def payload(data, status=200):
    return status, json.dumps({'success': status == 200, 'data': data}).encode(), 'application/json'


def fixture(profiles=None):
    return {
        ('forti', '/network/dhcp-pools'): payload({'pools': [
            {'id': 7, 'interface': 'SSID-Meztli', 'capacity': 253, 'active_leases': 12,
             'available_ips': 241, 'utilization_percent': 4.7, 'status': 'normal',
             'default_gateway': '10.0.0.1', 'netmask': '255.255.255.0'}]}),
        ('forti', '/network/interface-config'): payload([
            {'name': 'SSID-Meztli', 'vlan_id': 94, 'vdom': 'root', 'subnets': ['10.0.0.0/24', '10.1.0.0/24']},
            {'name': 'Red futura sin DHCP', 'vlan_id': 707, 'vdom': 'root', 'subnets': ['10.77.0.0/24']}]),
        ('omni', '/catalogs/access-role-profiles'): payload({'profiles': profiles or ['__SSID-Meztli', '__SSID-Mixcoatl']}),
        ('omni', '/catalogs/vlans'): payload({'vlans': []}),
        ('forti', '/network/dhcp-leases'): payload([{'interface': 'SSID-Meztli', 'ip': '10.0.0.9'}]),
    }


def test_discovers_new_names_each_read_without_declarations_and_preserves_dhcp():
    data = fixture()
    fetch = lambda provider, path: data[(provider, path)]
    first = catalog(fetch)
    assert not first['partial']
    assert {r['name'] for r in first['networks']} == {'SSID-Meztli', 'Mixcoatl', 'Red futura sin DHCP'}
    meztli = next(r for r in first['networks'] if r['kind'] == 'dhcp')
    assert meztli['id'] == 7 and meztli['vlan'] == 94
    assert meztli['capacity'] == 253 and meztli['active_leases'] == 12
    assert meztli['dhcp_clients'][0]['ip'] == '10.0.0.9'
    assert meztli['profiles'] == ['__SSID-Meztli']
    mixcoatl = next(r for r in first['networks'] if r['name'] == 'Mixcoatl')
    assert mixcoatl['capacity'] is None and mixcoatl['vlan'] is None
    data[('omni', '/catalogs/access-role-profiles')] = payload({'profiles': ['__SSID-Meztli', '__SSID-Mixcoatl', '__SSID-Nueva mañana']})
    assert 'Nueva mañana' in {r['name'] for r in catalog(fetch)['networks']}


def test_failed_vlan_endpoint_does_not_hide_networks_or_claim_complete():
    data = fixture()
    data[('omni', '/catalogs/vlans')] = payload(None, 502)
    result = catalog(lambda provider, path: data[(provider, path)])
    assert result['partial'] is True
    assert next(s for s in result['sources'] if s['endpoint'] == '/catalogs/vlans')['available'] is False
    assert 'Mixcoatl' in {r['name'] for r in result['networks']}


def test_available_vlan_catalog_adds_networks_and_clears_partial_warning():
    data = fixture()
    data[('omni', '/catalogs/vlans')] = payload({'vlans': [{'vlanId': 110, 'vlanName': 'CCTV'}]})
    result = catalog(lambda provider, path: data[(provider, path)])
    assert result['partial'] is False
    vlan = next(row for row in result['networks'] if row['name'] == 'CCTV')
    assert vlan['vlan'] == 110 and vlan['sources'] == ['omni']


def test_all_failed_sources_raise_instead_of_empty_success():
    with pytest.raises(AccessError) as error:
        catalog(lambda *args: payload(None, 502))
    assert error.value.status == 502


def test_empty_confirmed_catalog_is_valid_but_malformed_profiles_are_unavailable():
    data = { (provider, path): payload({collection: []} if collection else []) for provider, path, collection in SOURCES }
    data[('omni', '/catalogs/access-role-profiles')] = payload({'profiles': [{'name': 'unexpected'}]})
    result = catalog(lambda provider, path: data[(provider, path)])
    assert result['networks'] == [] and result['partial']
