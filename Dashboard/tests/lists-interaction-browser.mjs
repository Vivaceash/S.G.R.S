import { chromium, expect } from '@playwright/test';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1687, height: 882 } });
  const data = createDemo();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const item = { id: 'item-1', source_number: 1, description: 'Cable de prueba', quantity: 5, unit: 'piezas', status: 'Disponible', location: 'IDF 3', notes: 'Artículo de prueba', version: 1 };
  const movement = { id: 'movement-1', element: 'Cable retirado', idf_name: 'IDF 3', actor: 'test', actor_name: 'Persona de prueba', date: '2026-10-29T18:00:00Z', notes: 'Retiro de prueba', quantity: 1 };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/session' ? { user: { id: 'test', name: 'Prueba', username: 'test', role: 'super-admin' }, capabilities: ['dashboard.read', 'inventory.read', 'inventory.write', 'inventory.export', 'idf.read', 'activity.read'], roles: [] }
      : path === '/api/support/inventory' ? { items: [item] }
      : path === '/api/support/movements' ? { movements: [movement] }
      : path === '/api/networks' ? { networks: data.segments, sources: [], partial: false }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:5175';
  await page.goto(`${base}/#disponibilidad`);
  await page.locator('.ip-view-toggle').getByRole('button', { name: /Lista/ }).click();
  const ipRow = page.locator('tbody tr').first();
  await ipRow.locator('td').nth(1).click();
  await expect(page.getByRole('dialog', { name: 'Información · Direcciones IP' })).toBeVisible();
  await page.keyboard.press('Escape');
  await ipRow.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Información · Direcciones IP' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${base}/#soporte`);
  await page.locator('.support-network-card').first().locator('.support-card-main-title').click();
  await expect(page.getByRole('dialog', { name: 'Información de la red' })).toBeVisible();
  await page.keyboard.press('Escape');

  for (const width of [1687, 390]) {
    await page.setViewportSize({ width, height: 882 });
    await page.getByRole('tab', { name: 'Inventario soporte IDF 3' }).click();
    const entry = width > 500 ? page.locator('.support-inventory-table tbody tr').first() : page.locator('.support-inventory-mobile-card').first();
    await entry.locator('.support-inventory-name').click();
    await expect(page.getByRole('dialog', { name: 'Información del artículo' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Información del artículo' })).toContainText('Cable de prueba');
    await page.keyboard.press('Escape');
    await entry.getByRole('button', { name: /Modificar/ }).click();
    await expect(page.getByRole('dialog', { name: 'Información del artículo' })).not.toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Bitácora de soporte' }).click();
    const record = width > 500 ? page.locator('.support-log-table tbody tr').first() : page.locator('.support-log-mobile-card').first();
    await record.getByText('Cable retirado', { exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Detalle del registro' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
  console.log('PASS: generic list details, keyboard, support network cards, desktop/mobile inventory and movements, independent edit actions.');
} finally {
  await browser.close();
}
