import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const { SGRS_TEST_ORIGIN: origin, SGRS_TEST_TOKEN: token } = process.env;
assert.ok(origin && token);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const login = await context.request.post(`${origin}/api/auth/login`, {
    data: { username: 'support.qr', password: 'SupportTestPass123!' }, headers: { Origin: origin }
  });
  assert.equal(login.status(), 200, await login.text());
  const inventoryResponse = await context.request.get(`${origin}/api/support/inventory`);
  assert.equal(inventoryResponse.status(), 200, await inventoryResponse.text());
  const inventory = (await inventoryResponse.json()).items;
  assert.equal(inventory.length, 75);
  assert.equal(inventory.reduce((total, item) => total + item.quantity, 0), 518);
  assert.equal(inventory[0].description, 'Alcatel-Lucent 8135S');
  assert.ok(inventory.every(item => item.idf_id === 'idf-3' && item.status === 'Sin verificar'));
  const qr = `${origin}/?mobile=1&idf=idf-1&token=${encodeURIComponent(token)}#reporte`;
  const page = await context.newPage();
  await page.goto(qr);
  await expect(page.getByText('BITÁCORA DE SOPORTE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'IDF 1' })).toBeVisible();
  await page.getByLabel('Buscar artículo').fill('8135S');
  await page.getByLabel('Artículo retirado').selectOption(inventory[0].id);
  await page.getByLabel('Cantidad retirada').fill('2');
  await page.getByLabel('Número de identificación').fill('TON-E2E-001');
  await page.getByRole('button', { name: 'Registrar retiro' }).click();
  await expect(page.getByText('Indica el nombre completo de quien realiza el registro.')).toBeVisible();
  await page.getByLabel('Nombre completo de quien realiza el registro').fill('Persona de prueba');
  await page.locator('input[type="file"]').setInputFiles({ name: 'retiro.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64') });
  await page.getByRole('button', { name: 'Registrar retiro' }).click();
  await expect(page.getByRole('heading', { name: 'Retiro registrado' })).toBeVisible();
  const log = await context.request.get(`${origin}/api/support/movements`);
  assert.equal(log.status(), 200);
  const movements = (await log.json()).movements;
  assert.equal(movements.length, 1);
  assert.equal(movements[0].idf_id, 'idf-1');
  assert.equal(movements[0].identifier, 'TON-E2E-001');
  assert.equal(movements[0].inventory_item_id, inventory[0].id);
  assert.equal(movements[0].quantity, 2);
  const reduced = (await (await context.request.get(`${origin}/api/support/inventory`)).json()).items;
  assert.equal(reduced[0].quantity, 1);
  const supportCsrf = (await login.json()).csrf;
  const forbiddenCorrection = await context.request.post(`${origin}/api/support/inventory/quantity`, {
    data: { item_id: inventory[0].id, quantity: 9, version: reduced[0].version, reason: 'Sin permiso' },
    headers: { Origin: origin, 'X-CSRF-Token': supportCsrf }
  });
  assert.equal(forbiddenCorrection.status(), 403);
  assert.equal(movements[0].actor, 'Soporte de prueba');
  assert.equal(movements[0].actor_name, 'Persona de prueba');
  const evidenceUrl = `${origin}/api/support/movements/evidence/${movements[0].evidence}?view=1`;
  const photo = await context.request.get(evidenceUrl);
  assert.equal(photo.status(), 200);
  assert.equal(photo.headers()['content-type'], 'image/png');
  assert.ok((await photo.body()).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
  const session = await context.request.get(`${origin}/api/auth/session`);
  const { csrf } = await session.json();
  const logout = await context.request.post(`${origin}/api/auth/logout`, {
    data: {}, headers: { Origin: origin, 'X-CSRF-Token': csrf }
  });
  assert.equal(logout.status(), 200, await logout.text());
  const adminLogin = await context.request.post(`${origin}/api/auth/login`, {
    data: { username: 'owner.test', password: 'OwnerTestPass123!' }, headers: { Origin: origin }
  });
  assert.equal(adminLogin.status(), 200, await adminLogin.text());
  const adminCsrf = (await adminLogin.json()).csrf;
  const correction = await context.request.post(`${origin}/api/support/inventory/quantity`, {
    data: { item_id: inventory[0].id, quantity: 5, version: reduced[0].version, reason: 'Corrección de prueba' },
    headers: { Origin: origin, 'X-CSRF-Token': adminCsrf }
  });
  assert.equal(correction.status(), 200, await correction.text());
  assert.equal((await correction.json()).item.quantity, 5);
  const staleCorrection = await context.request.post(`${origin}/api/support/inventory/quantity`, {
    data: { item_id: inventory[0].id, quantity: 9, version: reduced[0].version, reason: 'Versión anterior' },
    headers: { Origin: origin, 'X-CSRF-Token': adminCsrf }
  });
  assert.equal(staleCorrection.status(), 409);
  await page.reload();
  await expect(page.getByText('REPORTE DE INCIDENCIA')).toBeVisible();
  await expect(page.getByText('BITÁCORA DE SOPORTE')).toHaveCount(0);
  await context.close();

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const hiddenPhoto = await publicContext.request.get(evidenceUrl);
  assert.equal(hiddenPhoto.status(), 401);
  const publicPage = await publicContext.newPage();
  await publicPage.goto(qr);
  await expect(publicPage.getByText('REPORTE DE INCIDENCIA')).toBeVisible();
  await publicContext.close();
  console.log('PASS: same IDF QR opens support form only for support, switches to IDF form after admin login, and keeps public IDF flow');
} finally {
  await browser.close();
}
