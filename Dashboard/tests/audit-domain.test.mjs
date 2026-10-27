import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTimestamp, auditDate, auditSummary, auditChangeRows, auditTargetLabel } from '../src/audit-domain.mjs';

test('audit dates preserve ISO, seconds, milliseconds and numeric strings without inventing today', () => {
  const expected = Date.parse('2026-09-09T01:55:00Z');
  for (const value of [expected, String(expected), expected / 1000, String(expected / 1000), '2026-09-08T19:55:00-06:00']) assert.equal(auditTimestamp(value), expected);
  for (const value of [null, undefined, '', false, 'Hoy, 14:15', '08/09/2026 19:55', 'invalid']) {
    assert.equal(auditTimestamp(value), null);
    assert.equal(auditDate(value), 'Fecha no determinada');
  }
});

test('audit user changes become a human summary instead of raw JSON', () => {
  const details = JSON.stringify({ before: { name: 'Nombre', role: 'viewer', capabilities: ['dashboard.read'] }, after: { name: 'Nombre', role: 'admin', capabilities: ['dashboard.read', 'users.read'] } });
  assert.equal(auditSummary('user.updated', details, 'Actualización'), 'Cambios en rol, permisos de acciones.');
  assert.equal(auditChangeRows(details).length, 2);
  const unchanged = { before: { capabilities: ['users.read', 'dashboard.read'] }, after: { capabilities: ['dashboard.read', 'users.read'] } };
  assert.equal(auditSummary('user.updated', unchanged, 'Actualización'), 'Se guardó la cuenta sin cambios en sus datos o permisos.');
  assert.equal(auditSummary('user.updated', '{broken', 'Actualización'), 'Actualización');
});

test('technical IDF target identifiers stay out of the row label', () => {
  assert.equal(auditTargetLabel({ target: 'idf-3:IDF-a-uuid', target_label: 'idf-3:IDF-a-uuid' }, [{ id: 'idf-3', name: 'IDF Soporte' }]), 'IDF Soporte · Registro IDF');
  assert.equal(auditTargetLabel({ target: 'idf-3:IDF-a-uuid', target_label: 'IDF Soporte · Revisión' }), 'IDF Soporte · Revisión');
});
