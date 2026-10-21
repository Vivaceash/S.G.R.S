import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModule, selectAction, ROLE_CAPABILITIES } from '../src/user-permissions.mjs';

const empty = () => ({ pages: [], submodules: [], capabilities: [] });
const all = () => true;

test('creating users enables the user module and reading without granting edit or delete', () => {
  const result = selectAction(empty(), 'usuarios', 'users.create', all, all);
  assert.deepEqual(result.pages, ['usuarios']);
  assert.deepEqual(result.capabilities, ['users.read', 'users.create']);
  assert.deepEqual(result.submodules, []);
});

test('disabling users removes its actions and preserves another selected module', () => {
  let result = selectAction(empty(), 'usuarios', 'users.create', all, all);
  result = selectModule(result, 'cctv', true, all, all);
  result = selectModule(result, 'usuarios', false, all, all);
  assert.deepEqual(result.pages, ['cctv']);
  assert.deepEqual(result.capabilities, ['inventory.read']);
  assert.deepEqual(result.submodules, ['cctv:updated', 'cctv:original']);
});

test('shared inventory actions survive while another enabled module uses them', () => {
  let result = selectAction(empty(), 'aps', 'inventory.write', all, all);
  result = selectModule(result, 'cctv', true, all, all);
  result = selectModule(result, 'aps', false, all, all);
  assert.ok(result.capabilities.includes('inventory.write'));
  assert.deepEqual(result.pages, ['cctv']);
});

test('delegation cannot grant missing read prerequisites or actions', () => {
  assert.deepEqual(selectAction(empty(), 'usuarios', 'users.create', cap => cap === 'users.create', all), empty());
  assert.deepEqual(selectAction(empty(), 'usuarios', 'users.delete', cap => cap === 'users.read', all), empty());
});

test('delegated tabs bring only their own read prerequisites', () => {
  const result = selectModule(empty(), 'soporte', true, cap => cap === 'dashboard.read', key => key === 'soporte:live');
  assert.deepEqual(result.pages, ['soporte']);
  assert.deepEqual(result.submodules, ['soporte:live']);
  assert.deepEqual(result.capabilities, ['dashboard.read']);
});

test('support defaults do not inherit administrative actions from their creator', () => {
  assert.ok(!ROLE_CAPABILITIES.soporte.includes('users.create'));
  assert.ok(!ROLE_CAPABILITIES.viewer.includes('inventory.write'));
});
