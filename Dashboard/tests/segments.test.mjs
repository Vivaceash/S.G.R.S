import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInSegment, deviceInSegment, getSegmentDevices, formatDeviceType, formatLocation, roleLabel, getUtilizationTone, getUtilizationColor } from '../src/domain.mjs';

test('active devices without a confirmed IP remain in their reported interface', () => {
  const segment = { interface: 'SSID-Meztli', subnet: '10.0.0.0/24' };
  assert.equal(deviceInSegment({ ip: '—', interface: 'SSID-Meztli', ip_source: 'unconfirmed' }, segment), true);
  assert.equal(deviceInSegment({ ip: '—', interface: 'other', ip_source: 'unconfirmed' }, segment), false);
  assert.equal(deviceInSegment({ ip: '10.0.1.1', interface: 'SSID-Meztli' }, segment), false);
  assert.equal(deviceInSegment({ ip: '10.0.0.99' }, segment), true);
});

test('CIDR and subnet masks include fixed IPs across /23 boundaries', () => {
  const segment = { default_gateway: '10.2.4.1', netmask: '255.255.254.0', ip_ranges: ['10.2.4.100 - 10.2.4.200'] };
  assert.equal(ipInSegment('10.2.5.250', segment), true);
  assert.equal(ipInSegment('10.2.6.1', segment), false);
  assert.equal(ipInSegment('10.2.4.10', segment), true);
  assert.equal(ipInSegment('10.2.5.250', { subnet: '10.2.4.0/23' }), true);
  assert.equal(ipInSegment('255.255.255.255', { subnet: '0.0.0.0/0' }), true);
  assert.equal(ipInSegment('10.2.4.2', { subnet: '10.2.4.1/32' }), false);
});
test('range fallback and missing/invalid addresses never leak all devices', () => {
  const segment = { ip_ranges: ['10.0.0.5 - 10.0.0.10', '10.0.1.1 - 10.0.1.9'] };
  for (const ip of ['10.0.0.5', '10.0.0.10', '10.0.1.8']) assert.equal(ipInSegment(ip, segment), true);
  for (const ip of ['10.0.0.11', '10.0.0.50', '', '—', '999.0.0.5']) assert.equal(ipInSegment(ip, segment), false);
  assert.equal(ipInSegment('10.0.0.5', undefined), false);
  assert.equal(roleLabel('super-admin'), 'Admin');
  assert.equal(roleLabel('admin'), 'admin');
});

test('getSegmentDevices returns only matching devices for a segment', () => {
  const segment = { interface: 'SSID-Meztli', subnet: '10.0.0.0/24' };
  const devices = [
    { ip: '10.0.0.50', name: 'PC-1', status: 'online' },
    { ip: '10.0.1.50', name: 'PC-2', status: 'online' },
    { ip: '—', interface: 'SSID-Meztli', ip_source: 'unconfirmed', name: 'PC-3', status: 'online' },
    { ip: '192.168.1.1', name: 'PC-4', status: 'online' }
  ];
  const matched = getSegmentDevices(devices, segment);
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map(d => d.name), ['PC-1', 'PC-3']);
  assert.deepEqual(getSegmentDevices([], segment), []);
  assert.deepEqual(getSegmentDevices(devices, null), []);
});

test('formatDeviceType classifies Computadora and Teléfono by OS and heuristics', () => {
  // Detección por sistema operativo explícito (Windows/macOS -> Computadora, Android/iOS -> Teléfono)
  assert.equal(formatDeviceType('Dispositivo', 'Windows 11', 'PC-Office', 'HP'), 'Computadora');
  assert.equal(formatDeviceType('Dispositivo', 'Windows', 'DESKTOP-123', 'Dell'), 'Computadora');
  assert.equal(formatDeviceType('Dispositivo', 'macOS', 'MacBook-Air', 'Apple'), 'Computadora');
  assert.equal(formatDeviceType('Dispositivo', 'Mac OS X', 'iMac', 'Apple'), 'Computadora');
  assert.equal(formatDeviceType('Dispositivo', 'Android', 'Galaxy-A54', 'Samsung'), 'Teléfono');
  assert.equal(formatDeviceType('Dispositivo', 'Android 14', 'POCO-X5', 'Xiaomi'), 'Teléfono');
  assert.equal(formatDeviceType('Dispositivo', 'iOS', 'iPhone-14-Pro', 'Apple'), 'Teléfono');
  assert.equal(formatDeviceType('Dispositivo', 'iPadOS', 'iPad-Mini', 'Apple'), 'Teléfono');

  // Clasificación por objeto de dispositivo
  assert.equal(formatDeviceType({ os: 'Windows 10', name: 'Workstation', vendor: 'Lenovo' }), 'Computadora');
  assert.equal(formatDeviceType({ raw: { os_name: 'macOS' }, name: 'MacBook', vendor: 'Apple' }), 'Computadora');
  assert.equal(formatDeviceType({ os: 'Android', name: 'Redmi-Note', vendor: 'Xiaomi' }), 'Teléfono');
  assert.equal(formatDeviceType({ os: 'iOS', name: 'iPhone', vendor: 'Apple' }), 'Teléfono');

  // Heurísticas de apoyo cuando no se reporta OS
  assert.equal(formatDeviceType('Computadora'), 'Computadora');
  assert.equal(formatDeviceType('Teléfono'), 'Teléfono');
  assert.equal(formatDeviceType('Móvil'), 'Teléfono');
  assert.equal(formatDeviceType('Unknown', 'Android_KMP3GLLR', 'Samsung'), 'Teléfono');
  assert.equal(formatDeviceType('Unknown', 'DESKTOP-4PD9M80', 'Fortinet'), 'Computadora');
  assert.equal(formatDeviceType('Unknown', 'POCO-M5s', 'Xiaomi'), 'Teléfono');
  assert.equal(formatDeviceType('Unknown', 'Bastian-MacBook-Pro', 'Apple'), 'Computadora');
  assert.equal(formatDeviceType('Unknown', 'iPhone-12', 'Apple'), 'Teléfono');
  assert.equal(formatDeviceType('Unknown', 'KM0679C0', 'Kyocera'), 'Impresora');
  assert.equal(formatDeviceType('Dispositivo', 'Desconocido', ''), 'Desconocido');
});

test('formatLocation strips interface and vendor redundancy', () => {
  assert.equal(formatLocation('Apple · SSID-Tlaloc', 'Apple', 'SSID-Tlaloc'), '—');
  assert.equal(formatLocation('Samsung · SSID-Tlaloc', 'Samsung', 'SSID-Tlaloc'), '—');
  assert.equal(formatLocation('IDF-12 -> 1/1/38', 'Apple', 'SSID-Tlaloc'), 'IDF-12 -> 1/1/38');
  assert.equal(formatLocation('MDF -> 2/1/45', 'Samsung', 'SSID-Tlaloc'), 'MDF -> 2/1/45');
  assert.equal(formatLocation('Apple', 'Apple', 'SSID-Tlaloc'), '—');
  assert.equal(formatLocation('—', 'Apple', 'SSID-Tlaloc'), '—');
  assert.equal(formatLocation('', '', ''), '—');
});

test('getUtilizationTone and getUtilizationColor classify percentage thresholds accurately', () => {
  // Verde: menor a 40%
  for (const pct of [0, 5, 8.3, 19.8, 39.9]) {
    assert.equal(getUtilizationTone(pct), 'green');
    assert.equal(getUtilizationColor(pct), '#19BF3E');
  }

  // Amarillo: 40% a menos de 70%
  for (const pct of [40, 40.0, 49.8, 55, 69.9]) {
    assert.equal(getUtilizationTone(pct), 'yellow');
    assert.equal(getUtilizationColor(pct), '#d97706');
  }

  // Naranja: 70% a menos de 85%
  for (const pct of [70, 70.0, 75, 80, 84.9]) {
    assert.equal(getUtilizationTone(pct), 'orange');
    assert.equal(getUtilizationColor(pct), '#ea580c');
  }

  // Rojo: 85% o más
  for (const pct of [85, 85.0, 89.3, 95, 100]) {
    assert.equal(getUtilizationTone(pct), 'red');
    assert.equal(getUtilizationColor(pct), '#ae1234');
  }
});
