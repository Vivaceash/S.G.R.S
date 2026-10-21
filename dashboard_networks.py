"""Current network catalog from configured providers; no manually maintained names."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ipaddress
import json
import re
import unicodedata

from dashboard_access import AccessError


SOURCES = (
    ('forti', '/network/dhcp-pools', 'pools'),
    ('forti', '/network/interface-config', None),
    ('omni', '/catalogs/access-role-profiles', 'profiles'),
    ('omni', '/catalogs/vlans', 'vlans'),
    ('forti', '/network/dhcp-leases', None),
)


def network_name(value):
    value = unicodedata.normalize('NFKD', str(value or ''))
    value = ''.join(c for c in value if not unicodedata.combining(c)).casefold()
    return re.sub(r'^ssid[-_\s]+', '', value.strip().lstrip('_'))


def catalog(fetch):
    """fetch(provider, path) returns an authenticated, sanitized gateway response."""
    observed_at = datetime.now(timezone.utc).isoformat()

    def read(source):
        provider, path, collection = source
        try:
            code, body, _ = fetch(provider, path)
            payload = json.loads(body)
            if code != 200 or not isinstance(payload, dict) or payload.get('success') is False or payload.get('error'):
                raise ValueError()
            data = payload.get('data')
            rows = data.get(collection) if collection and isinstance(data, dict) else data
            row_type = str if collection == 'profiles' else dict
            if not isinstance(rows, list) or any(not isinstance(row, row_type) for row in rows):
                raise ValueError()
            return rows, dict(provider=provider, endpoint=path, available=True, observed_at=observed_at)
        except Exception:
            return [], dict(provider=provider, endpoint=path, available=False, observed_at=observed_at)

    with ThreadPoolExecutor(max_workers=len(SOURCES)) as pool:
        responses = list(pool.map(read, SOURCES))
    sources = [source for _, source in responses]
    if not any(source['available'] for source in sources):
        raise AccessError(502, 'No se pudo consultar el catálogo de redes. Usa el botón de actualización para volver a consultar.')

    networks = []

    def empty(identifier, name, kind, provider):
        return dict(id=identifier, name=name, interface=name, kind=kind, sources=[provider],
                    vlan=None, subnet=None, default_gateway=None, netmask=None, ip_ranges=[],
                    capacity=None, active_leases=None, available_ips=None, utilization_percent=None,
                    status='unknown', saturation_status='unknown')

    def matching(name, vlan=None):
        matches = [row for row in networks if network_name(row['interface']) == network_name(name)]
        if not matches and vlan is not None:
            matches = [row for row in networks if row.get('vlan') == vlan]
        return matches[0] if len(matches) == 1 else None

    for pool in responses[0][0]:
        if not pool.get('interface'):
            continue
        row = {**empty(pool.get('id'), pool['interface'], 'dhcp', 'forti'), **pool}
        row['dhcp_clients'] = ([lease for lease in responses[4][0] if lease.get('interface') == pool['interface']]
                               if responses[4][1]['available'] else None)
        if row.get('default_gateway') and row.get('netmask'):
            try:
                row['subnet'] = str(ipaddress.ip_network(f"{row['default_gateway']}/{row['netmask']}", strict=False))
            except ValueError:
                pass
        networks.append(row)

    for interface in responses[1][0]:
        name = interface.get('name')
        if not name or not (interface.get('subnets') or interface.get('vlan_id') is not None):
            continue
        row = matching(name)
        if row is None:
            row = empty('forti:' + interface.get('vdom', 'root') + ':' + name, name, 'interface', 'forti')
            networks.append(row)
        row.update(vlan=interface.get('vlan_id'), subnets=interface.get('subnets', []),
                   alias=interface.get('alias'), vdom=interface.get('vdom'))
        if row.get('subnet') is None:
            row['subnet'] = next(iter(interface.get('subnets') or []), None)
        if row.get('default_gateway') is None and interface.get('addresses'):
            try:
                address = ipaddress.ip_interface(interface['addresses'][0])
                row.update(default_gateway=str(address.ip), netmask=str(address.netmask))
            except ValueError:
                pass

    for vlan in responses[3][0]:
        name = vlan.get('vlanName')
        if not name:
            continue
        try:
            vlan_id = int(vlan['vlanId'])
        except (KeyError, TypeError, ValueError):
            vlan_id = None
        row = matching(name, vlan_id)
        if row is None:
            row = empty('omni:vlan:' + str(vlan_id) + ':' + name, name, 'vlan', 'omni')
            row['vlan'] = vlan_id
            networks.append(row)
        if 'omni' not in row['sources']:
            row['sources'].append('omni')

    for profile in responses[2][0]:
        if not profile.strip():
            continue
        row = matching(profile)
        if row is None:
            name = re.sub(r'^SSID[-_\s]+', '', profile.lstrip('_'), flags=re.I)
            row = empty('omni:profile:' + profile, name, 'access_profile', 'omni')
            row['description'] = 'Perfil de acceso publicado por OmniVista. Capacidad DHCP no informada.'
            networks.append(row)
        row.setdefault('profiles', []).append(profile)
        if 'omni' not in row['sources']:
            row['sources'].append('omni')

    return dict(networks=networks, sources=sources, partial=any(not s['available'] for s in sources), observed_at=observed_at)
