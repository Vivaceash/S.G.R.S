import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { BASE_ROLE_CATALOG, ROLE_PAGE_DEFAULTS, defaultSubmodules } from '../src/domain.mjs';
import { ROLE_CAPABILITIES } from '../src/user-permissions.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  const nativeDialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  const data = createDemo();
  const actor = { id: 'owner', name: 'Responsable', username: 'owner', role: 'super-admin', version: 1,
    allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'], allowed_submodules: defaultSubmodules(ROLE_PAGE_DEFAULTS['super-admin']), capabilities: ROLE_CAPABILITIES['super-admin'] };
  const target = { id: 'target', name: 'Cuenta de prueba', username: 'cuenta.prueba', role: 'viewer', active: true, version: 1,
    allowed_pages: ROLE_PAGE_DEFAULTS.viewer, allowed_submodules: defaultSubmodules(ROLE_PAGE_DEFAULTS.viewer), capabilities: ROLE_CAPABILITIES.viewer };
  let item = { id: 'stock-1', source_number: 1, description: 'Cable de red de prueba', quantity: 12, unit: 'piezas', version: 1 };
  let deleteCalls = 0;
  let stockCalls = 0;
  let failDelete = true;
  let releaseStock;
  const stockGate = new Promise(resolve => { releaseStock = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/users/delete') {
      deleteCalls++;
      return failDelete ? route.fulfill({ status: 409, json: { error: 'La cuenta cambió. Revisa sus datos.' } }) : route.fulfill({ json: {} });
    }
    if (path === '/api/support/inventory/quantity') {
      stockCalls++;
      const body = route.request().postDataJSON();
      assert.equal(body.item_id, item.id);
      assert.equal(body.quantity, 15);
      assert.equal(body.reason, 'Conteo de prueba');
      await stockGate;
      item = { ...item, quantity: 15, version: 2 };
      return route.fulfill({ json: { item } });
    }
    const body = path === '/api/auth/session' ? { user: actor, csrf: 'test', roles: BASE_ROLE_CATALOG, allowed_pages: actor.allowed_pages, allowed_submodules: actor.allowed_submodules, capabilities: actor.capabilities }
      : path === '/api/admin/users' ? { users: [actor, target] }
      : path === '/api/support/inventory' ? { items: [item] }
      : path === '/api/networks' ? { networks: data.segments, sources: [], partial: false }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: body });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
  await page.goto(`${base}/#soporte?vista=inventory`);
  const trigger = page.getByRole('button', { name: 'Modificar cantidad', exact: true });
  await trigger.click();
  const stockDialog = page.getByRole('dialog', { name: 'Modificar cantidad', exact: true });
  await expect(stockDialog.getByLabel('Nueva cantidad', { exact: true })).toHaveValue('12');
  await page.keyboard.press('Escape');
  await expect(stockDialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  assert.equal(stockCalls, 0);
  await trigger.click();
  await stockDialog.getByLabel('Nueva cantidad', { exact: true }).fill('15');
  await stockDialog.getByLabel('Motivo de la corrección', { exact: true }).fill('Conteo de prueba');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(await stockDialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await stockDialog.screenshot({ path: `/tmp/sgrs-stock-dialog-${width}.png` });
  }
  const stockAccessibility = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa']).analyze();
  assert.deepEqual(stockAccessibility.violations.map(v => v.id), []);
  await stockDialog.getByRole('button', { name: 'Guardar cantidad', exact: true }).click();
  await expect.poll(() => stockCalls).toBe(1);
  await page.keyboard.press('Escape');
  await expect(stockDialog).toBeVisible();
  await expect(stockDialog.getByRole('button', { name: 'Cerrar diálogo' })).toBeDisabled();
  releaseStock();
  await expect(stockDialog).not.toBeVisible();

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#usuarios`);
  await page.getByRole('row').filter({ hasText: 'cuenta.prueba' }).getByRole('button', { name: 'Administrar', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Administrar Cuenta de prueba', exact: true });
  await editor.getByRole('button', { name: 'Eliminar usuario', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Eliminar usuario', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Eliminar usuario', exact: true })).toBeFocused();
  assert.equal(deleteCalls, 0);
  await editor.getByRole('button', { name: 'Eliminar usuario', exact: true }).click();
  await confirmation.screenshot({ path: '/tmp/sgrs-delete-dialog.png' });
  await confirmation.getByRole('button', { name: 'Eliminar cuenta', exact: true }).click();
  await expect(confirmation.getByText('La cuenta cambió. Revisa sus datos.', { exact: true })).toBeVisible();
  await expect(confirmation).toBeVisible();
  failDelete = false;
  await confirmation.getByRole('button', { name: 'Eliminar cuenta', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'cuenta.prueba' })).toHaveCount(0);
  assert.equal(deleteCalls, 2);
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(errors, []);
  console.log('PASS: shared inventory and deletion dialogs, cancellation, focus, pending save, errors, responsive layout and accessibility; all API writes mocked.');
} finally { await browser.close(); }
