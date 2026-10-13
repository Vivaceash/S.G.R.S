import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWidgetLayout, expiringConcessions, networkPressure, widgetAllowed } from '../src/widgets-domain.mjs';

test('stored layout tolerates removed widgets, duplicates and illegal widths', () => {
  assert.equal(sanitizeWidgetLayout({}), null);
  assert.deepEqual(sanitizeWidgetLayout([{ id: 'network', size: 3 }, { id: 'network', size: 12 }, { id: 'unknown', size: 6 }, null, { id: 'devices', size: 3 }]), [{ id: 'network', size: 12 }, { id: 'devices', size: 3 }]);
  assert.deepEqual(sanitizeWidgetLayout([]), []);
});
test('a page permission alone cannot expose a restricted submodule', () => {
  const session = { user: { role: 'admin' }, can: () => true, canViewPage: () => true, canViewSubmodule: () => false };
  for (const id of ['aps', 'stock', 'support-log', 'expiring', 'cctv', 'forti']) assert.equal(widgetAllowed(id, session), false, id);
  assert.equal(widgetAllowed('audit', { ...session, can: () => false }), false);
  for (const id of ['device-types', 'offline-devices', 'recent-incidents']) assert.equal(widgetAllowed(id, { ...session, canViewPage: () => false }), false, id);
});

test('DHCP pressure ranks actual utilization and ignores unconfirmed capacities', () => {
  const rows = networkPressure([
    { id: 'small', active_leases: 8, capacity: 10 },
    { id: 'large', active_leases: 40, capacity: 100 },
    { id: 'missing', active_leases: 90 },
    { id: 'invalid', active_leases: 'unknown', capacity: 20 },
    { id: 'zero', active_leases: 0, capacity: 20 },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['small', 'large', 'zero']);
  assert.equal(rows[0].occupiedPercent, 80);
});
test('expiring concessions exclude invalid, expired, unrelated and distant accounts', () => {
  const now = 1000000000;
  const users = [
    { username: 'soon', description: 'OFICIO 123', dateOfEffective: now + 1000 },
    { username: 'expired', description: 'oficio', dateOfEffective: now - 1000 },
    { username: 'other', description: 'Empleado', dateOfEffective: now + 1000 },
    { username: 'invalid', description: 'oficio', dateOfEffective: 'bad' },
    { username: 'later', description: 'oficio', dateOfEffective: now + 73 * 3600000 },
  ];
  assert.deepEqual(expiringConcessions(users, now).map(user => user.username), ['soon']);
});
