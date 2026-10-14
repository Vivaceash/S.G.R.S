import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { ROLE_PAGE_DEFAULTS } from '../src/domain.mjs';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install();
  const data = createDemo();
  let deviceReads = 0;
  const reads = [];
  await page.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET');
    const path = new URL(route.request().url()).pathname;
    if (path !== '/api/auth/session') reads.push(path);
    const body = path === '/api/auth/session' ? { user: { id: 'refresh-test', name: 'Prueba', role: 'super-admin', allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'] }, capabilities: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read'], csrf: 'mock' }
      : path === '/api/devices' ? (deviceReads++, data.devices)
      : path === '/api/idfs' ? data.idfs : path === '/api/ips' ? data.ips
      : path === '/api/reports' ? data.reports : path === '/api/health' ? data.health
      : path === '/api/forti/network/dhcp-pools' ? { data: { pools: data.segments } }
      : path === '/api/forti/network/dhcp-leases' ? { data: [] }
      : path === '/api/forti/system/resources' ? { data: { cpu_percent: 18, memory_percent: 43 } }
      : path === '/api/altas/omnivista' ? { success: true, data: { users: [] } }
      : path === '/api/aps/omnivista' ? { aps: [], summary: { total: 0, online: 0, offline: 0, clients: 0 } }
      : path === '/api/inventory/catalog' ? { assets: [], cabinets: [], observations: [], sources: [], structure: {}, revision: 'test' }
      : path === '/api/support/inventory' ? { items: [] }
      : path === '/api/support/movements' ? { movements: [] }
      : path === '/api/audit' ? { events: data.audit } : { principal_segments: null, modules: [] };
    return route.fulfill({ json: body });
  });
  await page.goto('http://127.0.0.1:3000/#resumen');
  const button = page.locator('.header-refresh');
  await expect(button).toBeEnabled();
  await expect(button.locator('.refresh-countdown-ring')).toHaveCount(0);
  await expect(button.locator('svg')).toHaveCSS('animation-name', 'none');
  await page.waitForLoadState('networkidle');
  const initialReads = reads.length;
  await page.clock.fastForward(120000);
  assert.equal(reads.length, initialReads, 'No periodic API reads in the dashboard or widgets');
  const initial = deviceReads;
  await button.click();
  await expect.poll(() => deviceReads).toBe(initial + 1);
  await page.waitForLoadState('networkidle');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-remaining', '15');
  await page.clock.fastForward(14000);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('data-remaining', '1');
  await page.clock.fastForward(1000);
  await expect(button).toBeEnabled();
  assert.equal(deviceReads, initial + 1, 'Cooldown expiry must not query APIs');
  await button.click();
  await expect.poll(() => deviceReads).toBe(initial + 2);
  await page.waitForLoadState('networkidle');
  await page.clock.fastForward(60000);
  assert.equal(deviceReads, initial + 2, 'No automatic refresh after a minute');
  await expect(button).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 700 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('tmp/refresh', { recursive: true });
  await page.screenshot({ path: 'tmp/refresh/mobile.png' });
  for (const route of ['soporte', 'gestion-meztli', 'aps', 'idf']) {
    await page.goto(`http://127.0.0.1:3000/#${route}`);
    await expect(button).toBeEnabled();
    await page.waitForLoadState('networkidle');
    const before = reads.length;
    await page.clock.fastForward(120000);
    assert.equal(reads.length, before, `No periodic API reads in ${route}`);
    if (route === 'aps') {
      const apReads = reads.filter(path => path === '/api/aps/omnivista').length;
      await button.click();
      await expect.poll(() => reads.filter(path => path === '/api/aps/omnivista').length).toBe(apReads + 1);
      await page.waitForLoadState('networkidle');
      await expect(button).toBeDisabled();
      await page.clock.fastForward(15000);
      await expect(button).toBeEnabled();
    }
    assert.deepEqual(pageErrors, [], `No browser errors in ${route}`);
  }
  console.log('PASS: actualización manual, cooldown de 15 segundos, icono estático y sin consultas periódicas en dashboard, widgets, soporte, DHCP, APs e IDF');
} finally { await browser.close(); }
