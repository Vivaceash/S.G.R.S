import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { createDemo } from '../src/demo.mjs';

const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? {executablePath: process.env.SGRS_BROWSER} : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const output = process.env.SGRS_ARTIFACT_DIR || '/tmp/sgrs-inventory-browser';
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-MX' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = createDemo();
  const identity = { user: { id: 'test-admin', name: 'Operador de prueba', username: 'operador', role: 'admin', version: 1 }, csrf: 'test-only', capabilities: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'inventory.write', 'idf.visits.write', 'inventory.export'] };
  const catalog = { revision: 'fixture', imported_at: '2026-09-17T12:00:00Z', cabinets: [{ id: 'idf-1', name: 'IDF 1' }], observations: [{ idf_id: 'idf-1', text: 'Observación documental de prueba' }], sources: [], structure: {}, assets: [
    ...Array.from({ length: 24 }, (_, i) => ({ id: `camera-${i}`, dataset: 'cctv', kind: 'equipment', name: `Cámara ${i + 1}`, idf_id: 'idf-1', model: 'Modelo de prueba', serial: `SERIE-${i}`, mac: `AA:BB:CC:DD:EE:${String(i).padStart(2, '0')}`, documented_ip: `192.0.2.${i + 1}`, location: 'Pasillo', version: 'fixture:0', relocated: i === 4, destination: i === 4 ? 'Farmacia' : '', issues: [], source: { file: 'Documento de prueba.xlsx', sheet: 'Hoja1', row: i + 5 } })),
    { id: 'original-1', dataset: 'cctv_original', name: 'Cámara original', idf_id: 'idf-1', kind: 'equipment', issues: [], documented_ip: '192.0.2.1' },
    { id: 'rack-1', dataset: 'idf', name: 'Rack documental', idf_id: 'idf-1', kind: 'rack', issues: [] },
    { id: 'ap-1', dataset: 'ap', name: 'AP documental', idf_id: '', kind: 'equipment', issues: ['Sin asignar'] },
  ] };
  let posts = 0, conflict = true, apiCalls = 0, catalogFails = false;
  await page.route('**/api/**', async route => {
    apiCalls++;
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: identity });
    if (['/api/inventory/catalog', '/api/inventarios/cctv/catalog'].includes(url.pathname)) return route.fulfill({ status: catalogFails ? 503 : 200, json: catalogFails ? { error: 'Unavailable' } : catalog });
    if (url.pathname === '/api/inventory/reconcile') return route.fulfill({ json: { revision: 'fixture', sources: [{ provider: 'forti', available: true, count: 1, observed_at: '2026-09-17T12:00:00Z' }, { provider: 'omni', available: false, count: null, observed_at: '2026-09-17T12:00:00Z' }], assets: { 'camera-0': { comparison: 'changed', ip: '192.0.2.200', status: 'online', observations: [] } }, only_api: [], scope: 'Las ausencias no acreditan bajas.' } });
    if (url.pathname === '/api/inventarios/reconciliation/jobs') return route.fulfill({ status: 202, json: { id: '11111111-1111-1111-1111-111111111111', status: 'queued' } });
    if (url.pathname.startsWith('/api/inventarios/reconciliation/jobs/')) return route.fulfill({ json: { status: 'partial', result: { revision: 'fixture', sources: [{ provider: 'forti', available: true, count: 1, observed_at: '2026-09-17T12:00:00Z' }, { provider: 'omni', available: false, count: null, observed_at: '2026-09-17T12:00:00Z' }], assets: { 'camera-0': { comparison: 'changed', ip: '192.0.2.200', status: 'online', observations: [] } }, only_api: [], scope: 'Las ausencias no acreditan bajas.' } } });
    if (['/api/inventory/asset', '/api/inventarios/cctv/asset'].includes(url.pathname)) {
      posts++;
      const body = route.request().postDataJSON();
      assert.equal(route.request().headers()['x-csrf-token'], 'test-only');
      await new Promise(resolve => setTimeout(resolve, 200));
      if (conflict) return route.fulfill({ status: 409, json: { error: 'El recurso cambió. Actualiza la consulta.' } });
      const original = catalog.assets.find(a => a.id === body.id);
      const asset = { ...original, ...body.fields, documented: { ...original }, version: 'fixture:1', corrected_at: '2026-09-17T12:10:00Z' };
      catalog.assets = catalog.assets.map(a => a.id === body.id ? asset : a);
      return route.fulfill({ json: { asset } });
    }
    const value = url.pathname.endsWith('dhcp-pools') ? { success: true, data: { pools: fixture.segments } } : fixture[url.pathname.split('/').pop()] ?? {};
    return route.fulfill({ json: value });
  });
  await page.goto(`${base}/#cctv`);
  await page.getByRole('cell', { name: 'Cámara 1', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 24);
  assert.equal(await page.locator('.pagination').count(), 0);
  await page.getByLabel('Buscar registros').fill('SERIE-23');
  await page.getByRole('cell', { name: 'Cámara 24', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  await page.getByRole('button', { name: 'Corregir datos físicos', exact: true }).click();
  await page.getByLabel('Ubicación física', { exact: true }).fill('Ubicación corregida');
  await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await page.getByText('El recurso cambió. Actualiza la consulta.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Ubicación física', { exact: true }).inputValue(), 'Ubicación corregida');
  await page.keyboard.press('Escape');
  await page.getByText('¿Descartar los cambios sin guardar?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
  conflict = false;
  await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await page.getByRole('cell', { name: 'Ubicación corregida', exact: true }).waitFor();
  assert.equal(posts, 2);
  assert.equal(catalog.assets.find(a => a.id === 'camera-23').location, 'Ubicación corregida');
  assert.equal(catalog.assets.find(a => a.id === 'camera-0').location, 'Pasillo', 'Filtered edit must retain the exact asset id');
  await page.getByRole('button', { name: 'Limpiar búsqueda', exact: true }).click();
  await page.getByLabel('Reubicación', { exact: true }).selectOption('Reubicada');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('tab', { name: /Originales/ }).click();
  await page.getByRole('cell', { name: 'Cámara original', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Corregir datos físicos', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Actualizadas/ }).click();
  await page.getByLabel('Reubicación', { exact: true }).selectOption('');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(v => v.id), []);
  await page.screenshot({ path: `${output}/cctv-mobile.png`, fullPage: true });
  await page.goto(`${base}/#aps`);
  await page.getByRole('tab', { name: /Catálogo documental/ }).click();
  await page.getByRole('cell', { name: 'AP documental', exact: true }).waitFor();
  catalogFails = true;
  await page.locator('.header-refresh').click();
  await page.getByRole('heading', { name: 'No se pudo cargar la información', exact: true }).waitFor();
  catalogFails = false;
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await page.getByRole('cell', { name: 'AP documental', exact: true }).waitFor();
  const beforeDemo = apiCalls;
  await page.goto(`${base}/?demo=1#cctv`);
  await page.getByRole('cell', { name: 'Cámara de ejemplo', exact: true }).waitFor();
  assert.equal(apiCalls, beforeDemo, 'Demo must never call real APIs');
  assert.equal(await page.getByRole('button', { name: 'Cotejar APIs', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: documentary routes, API priority/partial failure, exact-id editing, conflict, unsaved changes, historical immutability, infinite table, filters, mobile, axe, retry and isolated demo.');
} finally {
  await browser.close();
}
