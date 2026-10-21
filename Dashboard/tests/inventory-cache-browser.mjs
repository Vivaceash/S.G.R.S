import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const fixture = createDemo();
  const reads = { catalog: 0, aps: 0, map: 0 };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const catalog = { revision: 'cache-test', cabinets: [], assets: [
    { id: 'camera', dataset: 'cctv', name: 'Cámara cacheada', version: 'cache-test:0', location: 'Pasillo' },
    { id: 'original', dataset: 'cctv_original', name: 'Cámara histórica', version: 'cache-test:0' },
  ] };
  let apName = 'AP cacheado';
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/auth/session') body = { user: { id: 'inventory-cache-test', role: 'super-admin', name: 'Prueba' },
      capabilities: ['dashboard.read', 'inventory.read', 'inventory.write', 'idf.read', 'activity.read'], csrf: 'test' };
    else if (path === '/api/inventory/catalog') { reads.catalog++; body = catalog; }
    else if (path === '/api/aps/omnivista') { reads.aps++; body = { aps: [{ id: 'ap', name: apName, status: 'online' }], summary: { total: 1, online: 1, offline: 0, clients: 0 } }; }
    else if (path === '/api/aps/map') { reads.map++; body = { positions: [] }; }
    else if (path === '/api/networks') body = { networks: fixture.segments, sources: [], partial: false };
    else body = fixture[path.slice(5)] ?? {};
    await route.fulfill({ json: body });
  });
  const main = page.locator('main');
  const navigate = async name => { await page.evaluate(value => { location.hash = value; }, name); };
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000'}/#aps`);
  await expect(main.getByRole('cell', { name: 'AP cacheado', exact: true })).toBeVisible();
  await navigate('cctv');
  await expect(main.getByRole('cell', { name: 'Cámara cacheada', exact: true })).toBeVisible();
  await main.getByRole('tab', { name: /Originales/ }).click();
  await expect(main.getByRole('cell', { name: 'Cámara histórica', exact: true })).toBeVisible();
  await main.getByRole('tab', { name: /Actualizadas/ }).click();
  await navigate('aps');
  await expect(main.getByRole('cell', { name: 'AP cacheado', exact: true })).toBeVisible();
  assert.equal(reads.aps, 1); assert.equal(reads.catalog, 1);
  await main.getByRole('tab', { name: /Mapa/ }).click();
  await expect(main.getByText('Marcadores del plano', { exact: true })).toBeVisible();
  await navigate('cctv');
  await expect(main.getByRole('cell', { name: 'Cámara cacheada', exact: true })).toBeVisible();
  await page.reload();
  await expect(main.getByRole('cell', { name: 'Cámara cacheada', exact: true })).toBeVisible();
  assert.equal(reads.catalog, 1, 'recargar la pestaña reutiliza sessionStorage');
  await navigate('aps');
  await expect(main.getByRole('cell', { name: 'AP cacheado', exact: true })).toBeVisible();
  apName = 'AP actualizado';
  await page.getByRole('button', { name: 'Actualizar información', exact: true }).click();
  await expect(main.getByRole('cell', { name: apName, exact: true })).toBeVisible();
  assert.equal(reads.aps, 2, 'el botón debe consultar nuevos datos');
  await main.getByRole('tab', { name: /Mapa/ }).click();
  await expect(main.getByText('Marcadores del plano', { exact: true })).toBeVisible();
  assert.equal(reads.map, 1, 'el mapa también se reutiliza');
  await page.getByRole('button', { name: 'Actualizar información', exact: true }).click();
  await expect.poll(() => reads.map).toBe(2);
  await expect.poll(() => reads.aps).toBe(3);
  await navigate('cctv');
  await expect(main.getByRole('cell', { name: 'Cámara cacheada', exact: true })).toBeVisible();
  catalog.assets[0].location = 'Ubicación nueva';
  await page.getByRole('button', { name: 'Actualizar información', exact: true }).click();
  await expect(main.getByRole('cell', { name: 'Ubicación nueva', exact: true })).toBeVisible();
  assert.equal(reads.catalog, 2, 'actualizar CCTV sustituye la copia guardada');
  await page.locator('.account-button').click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('sgrs:inventory-cache:')).length)).toBe(0);
  assert.deepEqual(errors, []);
  console.log('PASS: AP/CCTV navigation, tabs, browser reload, explicit refresh, map cache and logout cleanup.');
} finally { await browser.close(); }
