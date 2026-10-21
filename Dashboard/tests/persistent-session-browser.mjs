import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { ROLE_PAGE_DEFAULTS, BASE_ROLE_CATALOG, CAPABILITY_LABELS, defaultSubmodules } from '../src/domain.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = { id: 'root', username: 'root.test', name: 'Administrador de prueba', role: 'super-admin', active: true, keep_session: true, allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'] };
  const identity = { user: root, csrf: 'test-csrf', roles: BASE_ROLE_CATALOG, capabilities: Object.keys(CAPABILITY_LABELS), allowed_pages: root.allowed_pages, allowed_submodules: defaultSubmodules(root.allowed_pages) };
  let target = { id: 'viewer', username: 'viewer.test', name: 'Usuario de prueba', role: 'viewer', active: true, version: 1, keep_session: false, allowed_pages: ROLE_PAGE_DEFAULTS.viewer, capabilities: ['dashboard.read'] };
  const fixture = createDemo();
  let sessionChecks = 0;
  let saves = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') { sessionChecks++; return route.fulfill({ json: identity }); }
    if (path === '/api/admin/users') return route.fulfill({ json: { users: [root, target] } });
    if (path === '/api/admin/users/save') {
      const body = route.request().postDataJSON();
      assert.equal(typeof body.keep_session, 'boolean');
      target = { ...target, ...body, id: body.id || 'created', version: target.version + 1 };
      saves++;
      return route.fulfill({ json: { user: target } });
    }
    if (path === '/api/admin/catalog') return route.fulfill({ json: { modules: [] } });
    return route.fulfill({ json: path.endsWith('dhcp-pools') ? { data: { pools: fixture.segments } } : fixture[path.split('/').pop()] ?? {} });
  });
  await page.clock.install();
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173'}/#usuarios`);
  const openTarget = () => page.getByRole('row').filter({ hasText: target.username }).getByRole('button', { name: 'Administrar', exact: true }).click();
  await openTarget();
  let dialog = page.getByRole('dialog', { name: 'Administrar Usuario de prueba' });
  await expect(dialog.getByLabel('Mantener sesión iniciada', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Mantener sesión iniciada', { exact: true }).check();
  await dialog.getByLabel(/Confirmo actualizar/).check();
  await dialog.getByRole('button', { name: 'Guardar usuario y permisos' }).click();
  await expect(dialog).not.toBeVisible();
  assert.equal(target.keep_session, true);
  await openTarget();
  await expect(dialog.getByLabel('Mantener sesión iniciada', { exact: true })).toBeChecked();
  await dialog.getByLabel('Mantener sesión iniciada', { exact: true }).uncheck();
  await dialog.getByLabel(/Confirmo actualizar/).check();
  await dialog.getByRole('button', { name: 'Guardar usuario y permisos' }).click();
  await expect(dialog).not.toBeVisible();
  assert.equal(target.keep_session, false);
  await page.getByRole('button', { name: 'Crear usuario', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Crear usuario', exact: true });
  await expect(dialog.getByLabel('Mantener sesión iniciada', { exact: true })).not.toBeChecked();
  await dialog.getByLabel(/Nombre completo/).fill('Nueva cuenta');
  await dialog.getByLabel(/Usuario de acceso/).fill('new.test');
  await dialog.getByLabel('Mantener sesión iniciada', { exact: true }).check();
  await dialog.getByLabel(/Confirmo crear/).check();
  await dialog.getByRole('button', { name: 'Crear usuario y asignar rol' }).click();
  await expect(dialog).not.toBeVisible();
  assert.equal(saves, 3);
  assert.equal(target.keep_session, true);
  const before = sessionChecks;
  await page.clock.fastForward(5 * 60 * 1000 + 1000);
  await expect.poll(() => sessionChecks).toBeGreaterThan(before);
  // Removing the setting also stops the renewal timer on the next identity refresh.
  root.keep_session = false;
  const priorRefresh = sessionChecks;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => sessionChecks).toBeGreaterThan(priorRefresh);
  await page.waitForTimeout(200);
  const normalChecks = sessionChecks;
  await page.clock.fastForward(5 * 60 * 1000 + 1000);
  await page.waitForTimeout(200);
  assert.equal(sessionChecks, normalChecks, 'Normal users must not receive persistent renewal');
  assert.deepEqual(errors, []);
  console.log('PASS: create/edit persistent-session checkbox, saved state, disable option, automatic renewal. No real accounts changed.');
} finally {
  await browser.close();
}
