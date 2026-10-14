import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAltasAnalytics, filterAltasUsers, devicePlatform, expiry, ALTAS_WIDGET_CATALOG } from '../src/altas-analytics.mjs';
import { sanitizeWidgetLayout } from '../src/widgets-domain.mjs';

const now = Date.parse('2026-10-14T12:00:00Z');
const android = { deviceMac: 'AA:BB:CC:DD:EE:01', deviceOS: 'Android' };
const users = [
  { username: 'temporal', description: 'Oficio 1', dateOfEffective: now + 3600000, department: 'Urgencias', devices: [android, { ...android, deviceMac: 'aa-bb-cc-dd-ee-01' }, { deviceMac: 'AA:BB:CC:DD:EE:02', deviceOS: 'Windows 11' }] },
  { username: 'vencida', description: 'Temporal', dateOfEffective: now - 1000, devices: [{ ...android }] },
  { username: 'sin-fecha', description: 'Oficio 2', dateOfEffective: 'inválida', devices: [{ deviceMac: 'AA:BB:CC:DD:EE:03', deviceOS: '', deviceName: 'Apple' }] },
  { username: 'normal', description: 'Plantilla', dateOfEffective: now + 86400000, devices: [] },
];
test('Temporales se identifican por oficio o concesión, no por cualquier fecha de la cuenta', () => {
  const result = buildAltasAnalytics(users, now);
  assert.equal(result.counts.temporary, 3);
  assert.equal(result.counts.valid, 1);
  assert.equal(result.counts.expired, 1);
  assert.equal(result.counts['no-expiry'], 1);
  assert.deepEqual(filterAltasUsers(users, { id: 'expiring24' }, now).map(user => user.username), ['temporal']);
  assert.equal(expiry({ dateOfEffective: 1e20 }), null);
});
test('Dispositivos y ranking deduplican MAC; compartir equipo no incrementa el total global', () => {
  const result = buildAltasAnalytics(users, now);
  assert.equal(result.deviceCount, 3);
  assert.equal(result.platforms.android, 1);
  assert.equal(result.ranking[0].username, 'temporal');
  assert.equal(result.ranking[0].count, 2);
  assert.deepEqual(filterAltasUsers(users, {id:'multiple-devices'}, now).map(user => user.username), ['temporal']);
  assert.equal(filterAltasUsers(users, {id:'platform',value:'android'}, now).length, 2);
});
test('No se infiere macOS de una marca; sistemas no reportados quedan explícitos', () => {
  assert.equal(devicePlatform({ deviceName: 'Apple', deviceFamily: 'Apple' }), 'unknown');
  assert.equal(devicePlatform({ deviceOS: 'iPhone OS 18' }), 'ios');
  assert.equal(devicePlatform({ deviceOS: 'Mac' }), 'macos');
  assert.equal(buildAltasAnalytics(users, now).platforms.unknown, 1);
});
test('Personalización de altas acepta su catálogo propio y descarta widgets ajenos', () => {
  assert.equal(ALTAS_WIDGET_CATALOG.length, 30);
  assert.deepEqual(sanitizeWidgetLayout([{id:'altas-android',size:3},{id:'metrics',size:12},{id:'altas-android',size:6}], ALTAS_WIDGET_CATALOG), [{id:'altas-android',size:3}]);
});
