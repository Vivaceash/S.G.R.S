import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { segmentKey } from '../src/domain.mjs';

const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
const realAuth = process.env.SGRS_PREFERENCES_REAL_AUTH === '1';
const browser = await chromium.launch({ executablePath: process.env.SGRS_BROWSER || chromium.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const data = createDemo();
  const identity = { user: { id: 'preference-test', name: 'Prueba', username: 'prueba', role: 'super-admin' }, csrf: 'test-only', capabilities: ['dashboard.read', 'inventory.read'] };
  let signedIn = true;
  let selected = null;
  let reads = 0;
  let writes = 0;
  let failReads = false;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (realAuth && path.startsWith('/api/auth/')) return route.continue();
    if (path === '/api/auth/session') return route.fulfill({ json: signedIn ? identity : { user: null } });
    if (path === '/api/auth/logout') { signedIn = false; return route.fulfill({ json: {} }); }
    if (path === '/api/auth/login') { signedIn = true; return route.fulfill({ json: identity }); }
    if (path === '/api/dashboard/preferences') {
      if (route.request().method() === 'POST') {
        writes++;
        assert.ok(route.request().headers()['x-csrf-token']);
        selected = route.request().postDataJSON().principal_segments;
      } else {
        reads++;
        if (failReads) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      }
      if (realAuth) return route.continue();
      return route.fulfill({ json: { principal_segments: selected } });
    }
    return route.fulfill({ json: path.endsWith('dhcp-pools') ? { success: true, data: { pools: data.segments } } : data[path.slice(5)] ?? {} });
  });
  const cards = page.locator('.segment-card h3');
  const signIn = async () => {
    await page.locator('input[autocomplete="username"]').fill(realAuth ? process.env.SGRS_PREFERENCES_USER : 'prueba');
    await page.locator('input[autocomplete="current-password"]').fill(realAuth ? process.env.SGRS_PREFERENCES_PASSWORD : 'test-only');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  };
  const loginAgain = async () => {
    await page.locator('.account-button').click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await signIn();
  };
  await page.goto(`${base}/#resumen`);
  if (realAuth) await signIn();
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.getByRole('button', { name: `Quitar ${data.segments[1].name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Guardar selección', exact: true }).click();
  await expect(page.getByText('Preferencia guardada', { exact: true })).toBeVisible();
  const desired = [data.segments[0].name, data.segments[2].name];
  await expect(cards).toHaveText(desired);
  if (realAuth) selected = (await (await context.request.get(`${base}/api/dashboard/preferences`)).json()).principal_segments;
  assert.deepEqual(selected, [segmentKey(data.segments[0]), segmentKey(data.segments[2])]);
  await loginAgain();
  await expect(cards).toHaveText(desired);
  if (realAuth) {
    const response = await context.request.get(`${base}/api/dashboard/preferences`);
    assert.equal(response.status(), 200);
    assert.deepEqual((await response.json()).principal_segments, selected);
  }
  assert.ok(reads >= 2);
  assert.equal(writes, 1);
  console.log('PASS: Guardar selección persists across logout and login');

  if (!realAuth) {
    failReads = true;
    await loginAgain();
    await expect(cards).toHaveText(desired);
    await expect(page.getByText('No se pudo consultar tu selección en la cuenta.', { exact: false }).first()).toBeVisible();
    assert.equal(writes, 1, 'An unavailable read must not overwrite account preferences');
    failReads = false;
    console.log('PASS: login preserves last confirmed selection when preference read fails');
  }

  // Selections saved by the previous browser-only version must move to the
  // account so that logging in without browser storage still restores them.
  if (!realAuth) {
    selected = null;
    const legacy = [segmentKey(data.segments[3])];
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `sgrs:principal-segments:${identity.user.id}`, value: legacy });
    const initialWrites = writes;
    await page.reload();
    await expect(cards).toHaveText([data.segments[3].name]);
    await expect.poll(() => writes).toBe(initialWrites + 1);
    assert.deepEqual(selected, legacy, 'Previously local preferences must be saved in the account');
    await page.evaluate(() => localStorage.clear());
    await loginAgain();
    await expect(cards).toHaveText([data.segments[3].name]);
    console.log('PASS: legacy browser selection migrates to account and survives login without local storage');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
