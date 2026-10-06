import ipaddress
from app.services.matching import mac, network_records, reconcile


def collection(response):
    payload = response.get('payload', {})
    data = payload.get('data')
    return data if response['http'] == 200 and payload.get('success') is True and isinstance(data, list) and all(isinstance(r, dict) for r in data) else None


def associate_network(ip, interface, configs):
    # All configurations belong to the one explicitly queried FortiGate/VDOM.
    candidates = [r for r in configs if interface and r.get('name') == interface]
    basis = 'observed_interface'
    if not candidates:
        basis = 'subnet_inference'
        try:
            address = ipaddress.ip_address(ip)
            candidates = [r for r in configs if any(address in ipaddress.ip_network(n, strict=False) for n in r.get('subnets', []))]
        except ValueError:
            return {}
    if len(candidates) != 1:
        return {'association': 'ambiguous' if candidates else 'unavailable'}
    row = candidates[0]
    return {**{k: row.get(k) for k in ('name', 'alias', 'vlan_id', 'parent', 'vdom', 'addresses', 'subnets')},
            'association': basis, 'source': 'forti.interface-config'}


def enrich(assets, responses):
    by_path = {r['endpoint']: r for r in responses}
    primary = [by_path[p] for p in ('/devices?view=operational', '/monitoring/devices')]
    result = reconcile(assets, primary)
    # ARP can confirm identity/address without claiming liveness from cached neighbor entries.
    arp_response = by_path['/network/arp-table']
    arp = collection(arp_response)
    leases = collection(by_path['/network/dhcp-leases'])
    configs = collection(by_path['/network/interface-config'])
    supplemental = []
    for label, rows in (('arp', arp), ('dhcp', leases)):
        if rows is not None:
            supplemental.append({'provider': 'forti-' + label, 'http': 200, 'observed_at': by_path['/network/arp-table' if label == 'arp' else '/network/dhcp-leases']['observed_at'],
                                 'payload': {'success': True, 'data': [{k: r.get(k) for k in ('mac', 'ip', 'interface', 'hostname')} for r in rows]}})
    if supplemental:
        result = reconcile(assets, primary + supplemental)
    sources = []
    for response in responses:
        if response in primary:
            try:
                network_records(response['provider'], response['payload'])
                available = response['http'] == 200
            except ValueError:
                available = False
        else:
            available = collection(response) is not None
        sources.append({k: response[k] for k in ('provider', 'endpoint', 'http', 'observed_at')} | {'available': available})
    result['sources'] = sources
    result['partial'] = not all(s['available'] for s in sources)
    result['networks'] = configs or []
    forti_payload = by_path['/devices?view=operational']['payload']
    raw_devices = forti_payload.get('data', {}).get('devices', []) if isinstance(forti_payload.get('data'), dict) else []
    extra_fields = ('hardware_vendor', 'hardware_family', 'device_type', 'os_name', 'os_version', 'last_seen', 'reserved_ip', 'ip_source', 'fortigate')
    for value in result['assets'].values():
        if value['comparison'] not in ('matched', 'changed'):
            value['vlan'] = {}
            continue
        forti_matches = [r for r in value['observations'] if r['provider'].startswith('forti')]
        interfaces = {r['interface'] for r in forti_matches if r.get('interface')}
        value['vlan'] = associate_network(value['ip'], next(iter(interfaces), ''), configs or []) if len(interfaces) <= 1 else {'association': 'ambiguous'}
        for observation in value['observations']:
            if observation['provider'] == 'forti' and observation['mac']:
                raw = [r for r in raw_devices if isinstance(r, dict) and mac(r.get('mac')) == observation['mac']]
                if len(raw) == 1:
                    observation.update({k: raw[0][k] for k in extra_fields if isinstance(raw[0].get(k), (str, int, float, bool))})
    return result
