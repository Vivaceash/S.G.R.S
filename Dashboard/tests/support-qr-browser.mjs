import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
const qr = `${origin}/?mobile=1&idf=idf-1&token=printed-idf-token#reporte`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined }); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let movement = null;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: 'support-1', name: 'Técnico de soporte', role: 'soporte' }, csrf: 'csrf-test' } });
    if (path === '/api/mobile-report') return route.fulfill({ json: { idf: { id: 'idf-1', name: 'IDF 1', zone: 'Planta baja' } } });
    if (path === '/api/support/inventory') return route.fulfill({ json: { items: [{ id: 'idf3-001', description: 'Alcatel-Lucent 8135S', quantity: 3, unit: 'pzas' }] } });
    if (path === '/api/support/movements') {
      movement = route.request().postDataJSON();
      assert.equal(route.request().headers()['x-csrf-token'], 'csrf-test');
      return route.fulfill({ json: { status: 'success', movement } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(qr);
  await expect(page.getByText('BITÁCORA DE SOPORTE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'IDF 1' })).toBeVisible();
  assert.equal(await page.getByLabel('Temperatura (°C)').count(), 0);
  await page.getByLabel('Nombre completo de quien realiza el registro').fill('Persona de prueba');
  await page.getByLabel('Buscar artículo').fill('8135S');
  await page.getByLabel('Artículo retirado').selectOption('idf3-001');
  await page.getByLabel('Cantidad retirada').fill('2');
  await page.getByLabel('Número de identificación').fill('TON-001');
  await page.locator('input[type="file"]').setInputFiles({ name: 'retiro.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64') });
  const sessionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sessionRefresh;
  await expect(page.getByLabel('Nombre completo de quien realiza el registro')).toHaveValue('Persona de prueba');
  await expect(page.getByLabel('Número de identificación')).toHaveValue('TON-001');
  await expect(page.getByText('retiro.png')).toBeVisible();
  await page.getByRole('button', { name: 'Registrar retiro' }).click();
  await expect(page.getByRole('heading', { name: 'Retiro registrado' })).toBeVisible();
  assert.equal(movement.idf_id, 'idf-1');
  assert.equal(movement.token, 'printed-idf-token');
  assert.equal(movement.inventory_item_id, 'idf3-001');
  assert.equal(movement.quantity, 2);
  assert.equal(movement.actor_name, 'Persona de prueba');
  assert.match(movement.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(errors, []);
  await context.close();

  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let loggedIn = false;
  await guest.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/support/inventory' ? { items: [{ id: 'idf3-001', description: 'Alcatel-Lucent 8135S', quantity: 3, unit: 'pzas' }] } : path === '/api/auth/session'
      ? loggedIn ? { user: { id: 'support-1', name: 'Técnico de soporte', role: 'soporte' }, csrf: 'csrf-test' } : { user: null }
      : { idf: { id: 'idf-1', name: 'IDF 1', zone: 'Planta baja' } } });
  });
  await guest.goto(qr);
  await expect(guest.getByText('REPORTE DE INCIDENCIA')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Abrir sesión de soporte' })).toBeVisible();
  const popupPromise = guest.context().waitForEvent('page');
  await guest.getByRole('button', { name: 'Abrir sesión de soporte' }).click();
  // A user gesture opens the regular login route separately from the scanned QR.
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`${origin}/#soporte`);
  await popup.close();
  loggedIn = true;
  await guest.getByRole('button', { name: 'Ya inicié sesión' }).click();
  await expect(guest.getByText('BITÁCORA DE SOPORTE')).toBeVisible();
  await guest.close();
  console.log('PASS: printed QR selects support form by role, records movement without randomUUID, and offers separate login tab');
} finally {
  await browser.close();
}
