import test from 'node:test';
import assert from 'node:assert/strict';
import { accountDeviceFields, deviceDate } from '../src/account-device-fields.mjs';

test('device dates accept Unix seconds, milliseconds and ISO in Mexico time', () => {
  const iso = '2026-10-29T18:00:00Z';
  const formatted = deviceDate(iso);
  assert.match(formatted, /29 oct 2026/);
  assert.match(formatted, /12:00/);
  for (const value of [Date.parse(iso), String(Date.parse(iso)), Date.parse(iso) / 1000, String(Date.parse(iso) / 1000)]) {
    assert.equal(deviceDate(value), formatted);
  }
  for (const value of [null, '', 'Unknown', 'invalid', 0, -1]) assert.equal(deviceDate(value), '');
});

test('device details remove duplicate identities, networks, vendors and unknown placeholders', () => {
  const fields = accountDeviceFields({ deviceName: 'leslie', deviceMac: '001122334455', deviceCategory: 'Mobile', deviceFamily: 'Apple', deviceOS: 'IOS', lastAccessDeviceSSID: 'Ehecatl', description: '—', forti: { hostname: '15.40.3.119', ip: '15.40.3.119', vendor: 'Apple', os: 'Unknown', type: 'Unknown', interface: 'SSID-Ehecatl', last_seen: 1793296800 } });
  assert.deepEqual(fields.filter(([, value]) => value === '15.40.3.119').map(([label]) => label), ['Dirección IP']);
  assert.equal(fields.filter(([, value]) => /ehecatl/i.test(value)).length, 1);
  assert.ok(!fields.some(([, value]) => value === 'Apple' || value.includes('Unknown') || value === '—'));
  assert.ok(fields.some(([label, value]) => label === 'Última detección FortiGate' && /2026/.test(value)));
});

test('device details retain distinct observations and use available fallback information', () => {
  const fields = Object.fromEntries(accountDeviceFields({ deviceCategory: 'Mobile', deviceOS: 'iOS', lastAccessDeviceSSID: 'Ehecatl', forti: { hostname: 'equipo-distinto', ip: '10.0.0.1', model: 'iPhone', os: 'Android', type: 'Tablet', interface: 'OtraRed' } }));
  assert.equal(fields['Nombre FortiGate'], 'equipo-distinto');
  assert.equal(fields['Sistema operativo FortiGate'], 'Android');
  assert.equal(fields['Interfaz FortiGate'], 'OtraRed');
  assert.equal(fields['Fabricante / modelo FortiGate'], 'iPhone');
  const fallback = Object.fromEntries(accountDeviceFields({ forti: { os: 'Windows', interface: 'DATA' } }));
  assert.equal(fallback['Sistema operativo'], 'Windows');
  assert.equal(fallback.Red, 'DATA');
});
