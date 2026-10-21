import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAltasAnalytics, filterAltasUsers, devicePlatform, expiry, ALTAS_WIDGET_CATALOG, migrateAltasWidgetLayout } from '../src/altas-analytics.mjs';
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
  assert.equal(ALTAS_WIDGET_CATALOG.length, 23);
  assert.deepEqual(sanitizeWidgetLayout([{id:'altas-platforms',size:4},{id:'metrics',size:12},{id:'altas-platforms',size:6}], ALTAS_WIDGET_CATALOG), [{id:'altas-platforms',size:4}]);
});

test('Cotejo de inactividad filtra solo evidencia confirmada y distingue pendientes', () => {
  const rows = [{ username: 'inactiva', activityAssessment: { status: 'inactive' } },
    { username: 'forti', activityAssessment: { status: 'observed' } },
    { username: 'parcial', activityAssessment: { status: 'unknown' } }, { username: 'anterior' }];
  assert.deepEqual(filterAltasUsers(rows, {id:'inactive-by-crosscheck'}).map(u => u.username), ['inactiva']);
  const counts = buildAltasAnalytics(rows).counts;
  assert.equal(counts['inactive-by-crosscheck'], 1);
  assert.equal(counts['activity-unverified'], 2);
});

test('Retired widgets migrate without duplicating or resetting saved positions', () => {
  const migrated = migrateAltasWidgetLayout([{id:'altas-accounts',size:6},
    {id:'altas-five-devices',size:3}, {id:'altas-multiple-devices',size:6},
    {id:'altas-android',size:3}, {id:'altas-ios',size:3}, {id:'altas-platforms',size:12},
    {id:'altas-active',size:3}, {id:'altas-inactive',size:3}]);
  assert.deepEqual(sanitizeWidgetLayout(migrated, ALTAS_WIDGET_CATALOG), [
    {id:'altas-accounts',size:6}, {id:'altas-multiple-devices',size:3},
    {id:'altas-platforms',size:4}, {id:'altas-account-status',size:4}]);
  assert.deepEqual(migrateAltasWidgetLayout([]), []);
  assert.equal(migrateAltasWidgetLayout(null), null);
});
test('Expiry windows do not overlap; multi-device count includes five or more', () => {
  const rows = [1, 2, 7, 8].map(days => ({username:String(days), description:'Temporal', dateOfEffective:now + days*86400000}));
  assert.deepEqual(filterAltasUsers(rows, {id:'expiring24'}, now).map(u=>u.username), ['1']);
  assert.deepEqual(filterAltasUsers(rows, {id:'expiring7'}, now).map(u=>u.username), ['2','7']);
  const devices = Array.from({length:5}, (_,i)=>({id:String(i)}));
  assert.equal(filterAltasUsers([{devices}], {id:'multiple-devices'}).length, 1);
});
test('OmniVista account status categories are exhaustive and disjoint', () => {
  const rows = [1, 0, 'normal', 'enabled', 'disabled', null].map(status=>({status}));
  const counts = buildAltasAnalytics(rows).counts;
  assert.equal(counts.active, 3); assert.equal(counts.inactive, 2); assert.equal(counts['unknown-status'], 1);
  const ids = ALTAS_WIDGET_CATALOG.map(widget=>widget.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const retired of ['five-devices','android','ios','windows','macos','linux','unknown','active','inactive','unknown-status']) assert.ok(!ids.includes(`altas-${retired}`));
});
