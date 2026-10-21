import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const base = process.env.SGRS_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? { executablePath: process.env.SGRS_BROWSER } : {}) });
try {
  const page = await browser.newPage();
  await page.clock.install();
  const fixture = createDemo();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let mode = 'valid', conflict = false, posts = 0, catalogReads = 0;
  let releaseSlow;
  const catalog = { revision: 'test', cabinets: [{ id: 'idf-1', name: 'IDF 1' }], assets: [
    { id: 'cam-1', dataset: 'cctv', name: 'Cámara actualizada', idf_id: 'idf-1', location: 'Pasillo', serial: 'SERIE-1', version: 'test:0' },
    { id: 'cam-2', dataset: 'cctv', name: 'Segunda cámara', idf_id: 'idf-1', location: 'Farmacia', serial: 'SERIE-2', version: 'test:0' },
    { id: 'old-1', dataset: 'cctv_original', name: 'Cámara original', idf_id: 'idf-1', version: 'test:0' },
  ] };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: 'test', name: 'Prueba', role: 'super-admin' }, csrf: 'test-only', capabilities: ['dashboard.read', 'inventory.read', 'inventory.write', 'inventory.export', 'idf.read', 'activity.read'] } });
    if (path === '/api/inventory/catalog') {
      catalogReads++;
      if (mode === 'slow') {
        const oldSnapshot = structuredClone(catalog);
        return new Promise(resolve => { releaseSlow = async () => { await route.fulfill({ json: oldSnapshot }).catch(() => {}); resolve(); }; });
      }
      if (mode === 'hang') return new Promise(() => {});
      if (mode === 'malformed') return route.fulfill({ json: { ...catalog, assets: null } });
      if (mode === 'offline') return route.fulfill({ status: 503, json: { error: 'API Inventarios no está disponible. Revisa su servicio y conexión.' } });
      if (mode === 'credentials') return route.fulfill({ status: 502, json: { error: 'Configura la credencial de API Inventarios.' } });
      return route.fulfill({ json: catalog });
    }
    if (path === '/api/inventory/asset') {
      posts++;
      assert.equal(route.request().headers()['x-csrf-token'], 'test-only');
      const body = route.request().postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 150));
      if (conflict) return route.fulfill({ status: 409, json: { error: 'El recurso cambió. Conserva tus cambios y actualiza la ficha.' } });
      const original = catalog.assets.find(a => a.id === body.id);
      const asset = { ...original, ...body.fields, version: 'test:1', documented: original };
      catalog.assets = catalog.assets.map(a => a.id === asset.id ? asset : a);
      return route.fulfill({ json: { asset } });
    }
    return route.fulfill({ json: path === '/api/networks' ? { networks: fixture.segments, sources: [], partial: false } : fixture[path.slice(5)] ?? {} });
  });
  const clearStoredCatalog = () => page.evaluate(() => { for (const key of Object.keys(sessionStorage)) if (key.startsWith('sgrs:inventory-cache:')) sessionStorage.removeItem(key); });
  const main = page.locator('#main-content');
  const updated = () => main.getByRole('cell', { name: 'Cámara actualizada', exact: true });
  await page.goto(`${base}/?documentos-cctv.filter.dataset=invalid#cctv`);
  await updated().waitFor();
  assert.equal(await main.locator('table tbody tr').count(), 2, 'invalid URL filter must not hide valid CCTV');
  await main.getByRole('searchbox').fill('SERIE-2');
  await main.getByRole('cell', { name: 'Segunda cámara', exact: true }).waitFor();
  await main.locator('table tbody tr').nth(1).waitFor({ state: 'hidden' });
  assert.equal(await main.locator('table tbody tr').count(), 1);
  await main.getByRole('searchbox').fill('');
  await main.getByRole('tab', { name: /Originales/ }).click();
  await main.getByRole('cell', { name: 'Cámara original', exact: true }).waitFor();
  await main.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Corregir datos físicos' }).count(), 0, 'historical catalogue stays read-only');
  await page.keyboard.press('Escape');
  await main.getByRole('tab', { name: /Actualizadas/ }).click();
  await updated().waitFor();

  for (const failure of ['malformed', 'offline', 'credentials']) {
    mode = failure;
    await clearStoredCatalog();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await main.getByRole('heading', { name: 'No se pudo cargar la información', exact: true }).waitFor();
    assert.equal(await main.locator('.loading-state').count(), 0);
    assert.equal(await main.locator('.metric-value').first().textContent(), '—', 'a failed query must not report zero cameras');
    if (failure === 'credentials') await main.getByText('Configura la credencial de API Inventarios.', { exact: true }).waitFor();
    assert.ok(await main.getByRole('heading', { name: 'Inventario CCTV', exact: true }).count(), 'provider credentials must not expire the dashboard session');
    mode = 'valid';
    await main.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
    await updated().waitFor();
  }

  assert.equal(await main.getByRole('button', { name: 'Actualizar catálogo', exact: true }).count(), 0);
  // A response from an abandoned module must not replace the current catalogue.
  mode = 'slow';
  await clearStoredCatalog();
  const staleRead = page.waitForRequest(r => r.url().includes('/api/inventory/catalog'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await staleRead;
  await page.evaluate(() => { location.hash = 'dispositivos'; });
  await main.getByRole('heading', { name: 'Inventario CCTV', exact: true }).waitFor({ state: 'hidden' });
  mode = 'valid';
  await page.evaluate(() => { location.hash = 'cctv'; });
  await releaseSlow();
  await updated().waitFor();

  // Two immediate clicks must create one write; the detail must reflect it.
  await updated().locator('..').getByRole('button', { name: 'Ver ficha', exact: true }).click();
  const detail = page.getByRole('dialog');
  await detail.getByRole('button', { name: 'Marcar como retirada', exact: true }).evaluate(button => { button.click(); button.click(); });
  await detail.getByRole('button', { name: 'Activar en inventario', exact: true }).waitFor();
  assert.equal(posts, 1);
  await detail.getByRole('button', { name: 'Corregir datos físicos', exact: true }).click();
  await page.getByLabel('Ubicación física', { exact: true }).fill('Ubicación corregida');
  conflict = true;
  await detail.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await detail.getByText('El recurso cambió. Conserva tus cambios y actualiza la ficha.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Ubicación física', { exact: true }).inputValue(), 'Ubicación corregida');
  conflict = false;
  await detail.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await main.getByRole('cell', { name: 'Ubicación corregida', exact: true }).waitFor();
  const readsBeforeReload = catalogReads;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await main.getByRole('cell', { name: 'Ubicación corregida', exact: true }).waitFor();
  assert.equal(catalogReads, readsBeforeReload, 'la corrección confirmada debe persistir en la caché del navegador');

  mode = 'hang';
  await clearStoredCatalog();
  const reads = catalogReads;
  const pendingRequest = page.waitForRequest(r => r.url().includes('/api/inventory/catalog'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pendingRequest;
  await new Promise(resolve => { const timer = setInterval(() => { if (catalogReads > reads) { clearInterval(timer); resolve(); } }, 10); });
  await page.clock.fastForward(26000);
  await main.getByRole('heading', { name: 'No se pudo cargar la información', exact: true }).waitFor();
  assert.equal(await main.locator('.loading-state').count(), 0);
  mode = 'valid';
  await main.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await updated().waitFor();
  assert.deepEqual(errors, []);
  console.log('CCTV: catálogos, filtros, ficha, correcciones, conflictos, respuesta atrasada, doble clic, respuesta inválida, servicio caído, credenciales, timeout y reintento verificados.');
} finally { await browser.close(); }
