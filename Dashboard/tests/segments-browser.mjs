import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ executablePath: '/opt/brave-bin/brave', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const data = createDemo();
  data.devices = Array.from({ length: 125 }, (_, i) => ({ name: `Local ${i}`, ip: `192.168.10.${i + 1}`, status: 'online' }));
  data.devices.push({ name: 'Otro segmento', ip: '192.168.20.1', status: 'online' });
  data.devices.push({ name: 'Reserva desconectada', ip: '192.168.20.2', status: 'offline', is_reserved: true });
  data.devices.push({ name: 'Histórico sin reserva', ip: '192.168.20.3', status: 'offline' });
  data.devices.push({ name: 'Activo con IP pendiente', ip: '—', status: 'online', ip_source: 'unconfirmed', interface: data.segments[0].interface });
  let role = 'super-admin';
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/session' ? { user: { id: 'segments-test', name: 'Prueba', username: 'prueba', role }, capabilities: ['dashboard.read', 'inventory.read'], roles: [] }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
        : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173';
  await page.goto(base);
  await page.locator('.segment-card').first().waitFor();
  assert.equal(await page.locator('.account-button small').innerText(), 'Admin');
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.getByRole('button', { name: 'Quitar Tonatiuh', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar selección' }).click();
  assert.equal(await page.locator('.segment-card').count(), 2);
  await page.reload();
  await page.locator('.segment-card').first().waitFor();
  assert.equal(await page.locator('.segment-card').count(), 2);
  await page.getByRole('button', { name: 'Ver dispositivos', exact: true }).first().click();
  await page.locator('tbody tr').first().waitFor();
  assert.equal(await page.locator('tbody tr').count(), 25);
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  assert.equal(await page.getByRole('cell', { name: 'Otro segmento', exact: true }).count(), 0);
  assert.match(await page.locator('tbody').innerText(), /192\.168\.10\.26/);
  await page.reload();
  await page.locator('tbody tr').first().waitFor();
  assert.match(await page.locator('tbody').innerText(), /192\.168\.10\.26/);
  for (const size of ['50', '100', 'all']) {
    await page.getByLabel('Dispositivos por página').selectOption(size);
    assert.equal(await page.locator('tbody tr').count(), size === 'all' ? 126 : Number(size));
    assert.equal(await page.getByRole('cell', { name: 'Otro segmento', exact: true }).count(), 0);
  }
  await page.getByRole('cell', { name: 'Activo con IP pendiente', exact: true }).waitFor();
  await page.getByRole('cell', { name: 'Pendiente de confirmar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ver todos los segmentos' }).click();
  await page.getByRole('cell', { name: 'Otro segmento', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 128);
  assert.equal(await page.getByRole('cell', { name: 'Histórico sin reserva', exact: true }).count(), 0);
  await page.getByLabel('Estado', { exact: true }).selectOption('offline');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('cell', { name: 'Reserva desconectada', exact: true }).waitFor();
  assert.match(await page.locator('tbody').innerText(), /IP reservada/);
  await page.goto(`${base}/#resumen`);
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id), []);
  await page.screenshot({ path: 'artifacts/segment-picker-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.screenshot({ path: 'artifacts/segment-picker.png', fullPage: true });
  await page.getByRole('button', { name: 'Agregar Tonatiuh', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await page.locator('.segment-card').count(), 2);
  role = 'admin';
  await page.reload();
  await page.locator('.account-button').waitFor();
  assert.equal(await page.locator('.account-button small').innerText(), 'admin');
  assert.deepEqual(errors, []);
  console.log('PASS: role labels, segment selection/persistence/cancel, filtered pagination/reload/25/50/100/all, mobile modal accessibility');
} finally { await browser.close(); }
