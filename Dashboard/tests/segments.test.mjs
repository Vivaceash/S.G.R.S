import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInSegment, deviceInSegment, roleLabel } from '../src/domain.mjs';

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
