import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSegmentAccounts, networkAccountStatus } from '../src/domain.mjs';

test('network accounts include profiles without hardware and count multiple devices once', () => {
  const segment = { name: 'SSID-Quetzacoatl', interface: 'SSID-Quetzacoatl', subnet: '15.40.1.0/24' };
  const accounts = [
    { username: 'sin.equipo', accessRoleProfile: '__SSID-Quetzacoatl', devices: [] },
    { username: 'dos.equipos', accessRoleProfile: '__SSID-Quetzacoatl', devices: [{ deviceMac: '001122334455' }, { deviceMac: '112233445566' }] },
    { username: 'otra.red', accessRoleProfile: '__SSID-Ehecatl', devices: [] },
    { username: 'prefijo', accessRoleProfile: '__SSID-Quetzacoatl-invitados', devices: [] },
    { username: 'detectada', devices: [{ forti: { ip: '15.40.1.10' } }] },
  ];
  assert.deepEqual(getSegmentAccounts(accounts, segment).map(account => account.username), ['sin.equipo', 'dos.equipos', 'detectada']);
  assert.deepEqual(getSegmentAccounts(accounts, null), []);
});

test('accounts can belong to an aggregated profile and duplicates do not inflate totals', () => {
  const accounts = [{ username: 'Cuenta', accessRoleProfile: '__SSID-RedA' }, { username: 'cuenta', accessRoleProfile: '__SSID-RedA' }];
  assert.equal(getSegmentAccounts(accounts, { name: 'Redes agrupadas', profiles: ['__SSID-RedA'] }).length, 1);
});

test('account enabled status stays independent of device connectivity', () => {
  for (const value of [1, '1', 'active', 'online', 'enabled']) assert.equal(networkAccountStatus(value), 'active');
  for (const value of [0, '0', 'inactive', 'offline', 'disabled']) assert.equal(networkAccountStatus(value), 'inactive');
  for (const value of [null, undefined, '', 'pending']) assert.equal(networkAccountStatus(value), 'unknown');
});
