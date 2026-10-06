import test from 'node:test';
import assert from 'node:assert/strict';
import { getOverviewSegmentDevices, getSegmentDevices } from '../src/domain.mjs';

test('Meztli lista las concesiones DHCP aunque ARP tenga más equipos', () => {
  const segment = { name: 'Meztli', interface: 'SSID-Meztli', subnet: '192.168.94.0/24' };
  const confirmed = Array.from({ length: 6 }, (_, index) => ({ name: `Equipo ${index}`, status: 'online', ip: `192.168.94.${index + 10}`, mac: `00:11:22:33:44:0${index}`, interface: segment.interface, ip_source: index % 2 ? 'dhcp+arp' : 'arp' }));
  segment.dhcp_clients = confirmed.map(device => ({ ip: device.ip, mac: device.mac, hostname: device.name, interface: segment.interface }));
  const pending = Array.from({ length: 20 }, (_, index) => ({ name: `Pendiente ${index}`, status: 'online', ip: '—', ip_source: 'unconfirmed', interface: segment.interface }));
  const rows = [...confirmed, ...pending,
    { status: 'online', ip: '192.168.94.99', ip_source: 'unconfirmed' },
    { status: 'online', ip: '192.168.94.98', ip_source: 'device-detection' },
    { status: 'online', ip: '192.168.94.97' },
    { status: 'online', ip: '—', interface: segment.interface },
    { status: 'offline', ip: '192.168.94.100', ip_source: 'reservation', is_reserved: true },
    { status: 'online', ip: '192.168.93.10', ip_source: 'dhcp', interface: segment.interface },
  ];
  const clients = getOverviewSegmentDevices(rows, segment);
  assert.deepEqual(clients.map(device => device.ip), confirmed.map(device => device.ip));
  assert.equal(clients.length, 6);
  assert.ok(clients.every(device => device.ip_source === 'dhcp'));
  assert.equal(getOverviewSegmentDevices([...rows, { status: 'online', ip: '192.168.94.20', ip_source: 'arp' }], segment).length, 6);
  segment.dhcp_clients.push({ ip: '192.168.94.21', mac: '00:11:22:33:44:07', hostname: 'Cliente nuevo' });
  assert.equal(getOverviewSegmentDevices(rows, segment).length, 7);
  assert.equal(getOverviewSegmentDevices(rows, segment).at(-1).name, 'Cliente nuevo');
  assert.ok(getSegmentDevices(rows, segment).length > 6, 'El inventario conserva las sesiones pendientes');
});

test('La IP DHCP actual reemplaza datos históricos y no inventa clientes si falta la consulta', () => {
  const segment = { name: 'Meztli', interface: 'SSID-Meztli', dhcp_clients: [{ ip: '192.168.94.20', mac: '00:11:22:33:44:55' }] };
  const rows = [{ name: 'Equipo conocido', interface: segment.interface, ip: '192.168.94.99', mac: '001122334455', status: 'offline', ip_source: 'unconfirmed' }];
  const clients = getOverviewSegmentDevices(rows, segment);
  assert.equal(clients[0].name, 'Equipo conocido');
  assert.equal(clients[0].ip, '192.168.94.20');
  assert.equal(clients[0].ip_source, 'dhcp');
  assert.deepEqual(getOverviewSegmentDevices(rows, { ...segment, dhcp_clients: null }), []);
});

test('Reconoce Meztli por interfaz y conserva el comportamiento de las demás tarjetas', () => {
  const pending = { status: 'online', ip: '—', ip_source: 'unconfirmed', interface: 'SSID-Meztli' };
  assert.deepEqual(getOverviewSegmentDevices([pending], { interface: 'SSID-Meztli', subnet: '192.168.94.0/24' }), []);
  const other = { name: 'Tonatiuh', interface: 'SSID-Tonatiuh', subnet: '192.168.93.0/24' };
  const rows = [{ ...pending, interface: other.interface }, { status: 'offline', ip: '192.168.93.20', is_reserved: true }];
  assert.deepEqual(getOverviewSegmentDevices(rows, other), getSegmentDevices(rows, other));
  assert.deepEqual(getOverviewSegmentDevices(null, other), []);
  assert.deepEqual(getOverviewSegmentDevices(rows, null), []);
});
