import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? {executablePath: process.env.SGRS_BROWSER} : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const section of ['aps', 'cctv']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const data = createDemo();
    const identity = { user: { id: 'session-test', name: 'Operador de prueba', role: 'admin', version: 1 }, csrf: 'test-only', capabilities: ['dashboard.read', 'inventory.read', 'inventory.write', 'idf.read', 'activity.read'] };
    let sessionExpired = false;
    let logins = 0;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/session') return route.fulfill({ json: identity });
      if (path === '/api/auth/login') {
        sessionExpired = false;
        logins++;
        return route.fulfill({ json: identity });
      }
      if (path === '/api/inventory/catalog') return route.fulfill({ status: sessionExpired ? 401 : 502, json: { error: sessionExpired ? 'Inicia sesión para acceder al sistema.' : 'Configura la credencial de API Inventarios.' } });
      if (path === '/api/aps/omnivista') return route.fulfill({ json: { aps: [], summary: {} } });
      return route.fulfill({ json: path.endsWith('dhcp-pools') ? { success: true, data: { pools: data.segments } } : data[path.split('/').pop()] ?? {} });
    });
    const heading = page.getByRole('heading', { name: section === 'aps' ? 'Inventario de access points' : 'Inventario CCTV', exact: true });
    const login = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    await page.goto(`${base}/#${section}`);
    if (section === 'aps') await page.getByRole('tab', { name: /Catálogo documental/ }).click();
    await page.getByRole('heading', { name: 'No se pudo cargar la información', exact: true }).waitFor();
    assert.equal(await heading.isVisible(), true);
    assert.equal(await login.count(), 0, `${section}: un error de integración debe conservar la sesión`);

    // A real local 401 still expires the session; signing in from the same
    // inventory URL must recover even while the provider remains unavailable.
    sessionExpired = true;
    await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
    await login.waitFor();
    assert.equal(new URL(page.url()).hash, `#${section}`);
    await page.locator('input[autocomplete="username"]').fill('operador.prueba');
    await page.locator('input[autocomplete="current-password"]').fill('test-only');
    await login.click();
    if (section === 'aps') await page.getByRole('tab', { name: /Catálogo documental/ }).click();
    await page.getByRole('heading', { name: 'No se pudo cargar la información', exact: true }).waitFor();
    assert.equal(await heading.isVisible(), true);
    assert.equal(await login.count(), 0, `${section}: iniciar sesión no debe entrar en un ciclo`);
    assert.equal(logins, 1);
    assert.deepEqual(errors, []);
    console.log(`PASS ${section}: provider failure preserves session; actual expiry and login recover at the same URL`);
    await context.close();
  }
} finally {
  await browser.close();
}
