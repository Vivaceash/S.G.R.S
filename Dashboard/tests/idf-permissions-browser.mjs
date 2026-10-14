import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: process.env.SGRS_BROWSER || '/opt/brave-origin-bin/brave', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const pages of [['bitacora-idf'], ['idf'], ['idf', 'bitacora-idf'], ['resumen']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = createDemo();
    fixture.reports['idf-3'] = { incidents: [{ id: 'permission-test', title: 'Incidencia pendiente', description: 'Revisar gabinete', status: 'open', tech: 'Operador de prueba', date: '2026-10-09T12:00:00Z', temp: 22, record_key: 'a'.repeat(64) }] };
    const identity = { user: { id: 'permission-test', name: 'Operador de prueba', role: 'admin', version: 1 }, csrf: 'test-only', allowed_pages: pages, capabilities: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'inventory.write', 'idf.visits.write'] };
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      requests.push(path + url.search);
      if (path === '/api/auth/session') return route.fulfill({ json: identity });
      if (path === '/api/reports/resolve' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (body.idf_id !== 'idf-3' || body.record_key !== 'a'.repeat(64)) {
          return route.fulfill({ status: 422, json: { error: 'Selecciona una incidencia vigente de la bitácora.' } });
        }
        const incident = { ...fixture.reports['idf-3'].incidents[0], status: 'resolved', record_key: 'b'.repeat(64), resolved_at: '2026-10-09T12:30:00Z' };
        fixture.reports['idf-3'].incidents = [incident];
        return route.fulfill({ json: { status: 'success', incident } });
      }
      if (path === '/api/idfs' && url.searchParams.get('view') === 'general') {
        return route.fulfill({ json: fixture.idfs.map(idf => ({ id: idf.id, name: idf.name, incidents: idf.incidents || [], device_count: (idf.devices || []).length, offline_count: 0 })) });
      }
      const value = path.endsWith('dhcp-pools') ? { success: true, data: { pools: fixture.segments } }
        : path.endsWith('dhcp-leases') ? { success: true, data: [] } : fixture[path.split('/').pop()] ?? {};
      return route.fulfill({ json: value });
    });
    // A stale selection must never grant individual access to an overview-only account.
    await page.addInitScript(() => sessionStorage.setItem('sgrs:idf-view:permission-test', JSON.stringify({ selectedId: 'idf-3', tab: 'inventory' })));
    await page.goto(`${base}/#idf`);
    if (pages.includes('bitacora-idf') && !pages.includes('idf')) {
      const table = page.getByRole('table', { name: 'Bitácora consolidada de visitas a IDFs' });
      await table.waitFor();
      await page.getByText('Incidencia pendiente', { exact: true }).waitFor();
      assert.equal(await page.locator('.audit-kpi').count(), 0);
      assert.equal(await page.getByRole('tab').count(), 0);
      assert.equal(await page.getByRole('button', { name: /^IDF-03:/ }).isDisabled(), true);
      assert.equal(await page.locator('.audit-activity-content strong').first().evaluate(el => getComputedStyle(el).fontSize), '18px');
      await page.getByRole('button', { name: 'Ver', exact: true }).first().click();
      assert.equal(await page.getByRole('button', { name: 'Confirmar resolución', exact: true }).count(), 0);
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#entrada?idf=idf-3`);
      await table.waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Reportar inconveniente en IDF', exact: true }).count(), 0);
      assert.ok(requests.includes('/api/idfs?view=general'));
      assert.ok(requests.includes('/api/reports?view=general'));
      assert.ok(!requests.includes('/api/idfs'));
      assert.ok(!requests.includes('/api/reports'));
      assert.ok(!requests.includes('/api/audit'));
      for (const width of [390, 1672]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Table scroll must stay inside the page');
      }
    } else if (pages.includes('idf')) {
      await page.getByRole('tab', { name: 'Inventario', exact: true }).waitFor();
      await page.getByRole('button', { name: /^IDF-03:/ }).click();
      await page.getByRole('tab', { name: 'Bitácora', exact: true }).click();
      await page.getByText('Incidencia pendiente', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Resolver', exact: true }).count(), 1);
      const all = page.getByRole('button', { name: 'Ver todos los IDF', exact: true });
      if (pages.includes('bitacora-idf')) {
        await all.click();
        await page.getByRole('table', { name: 'Bitácora consolidada de visitas a IDFs' }).waitFor();
        assert.equal(await page.locator('.audit-kpi').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Resolver', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Ver', exact: true }).first().click();
        assert.equal(await page.getByRole('button', { name: 'Confirmar resolución', exact: true }).count(), 0);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^IDF-03:/ }).click();
        assert.equal(await page.locator('.audit-activity-content strong').first().evaluate(el => getComputedStyle(el).fontSize), '18px');
      } else {
        assert.equal(await all.count(), 0);
        assert.equal(await page.getByRole('table', { name: 'Bitácora consolidada de visitas a IDFs' }).count(), 0);
      }
      assert.ok(requests.includes('/api/idfs'));
      assert.ok(requests.includes('/api/reports'));
      // Resolve the actual incident from the eye/detail modal, not the row shortcut.
      const incidentRow = page.getByRole('row').filter({ hasText: 'Incidencia pendiente' });
      await incidentRow.getByRole('button', { name: 'Ver', exact: true }).click();
      const resolution = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports/resolve' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Confirmar resolución', exact: true }).click();
      const response = await resolution;
      assert.deepEqual(response.request().postDataJSON(), { idf_id: 'idf-3', record_key: 'a'.repeat(64) }, 'Detail confirmation must submit the selected incident identifiers');
      assert.equal(response.status(), 200);
      await page.getByRole('button', { name: 'Confirmar resolución', exact: true }).waitFor({ state: 'detached' });
      await incidentRow.getByText('Resuelto', { exact: true }).waitFor();
      assert.equal(await incidentRow.getByRole('button', { name: 'Resolver', exact: true }).count(), 0);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await incidentRow.locator('.audit-activity-content strong').evaluate(el => getComputedStyle(el).fontSize), '18px');
        assert.equal(await incidentRow.locator('.audit-desc-text').evaluate(el => getComputedStyle(el).fontSize), '16px');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Individual log scroll must stay inside the page');
      }
      console.log('PASS IDF detail confirmation saves and updates the incident');
    } else {
      await page.getByRole('heading', { name: 'Dashboard Operativo', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: /^Registro IDF/ }).count(), 0);
      assert.ok(!requests.some(path => /^\/api\/(idfs|reports)/.test(path)));
    }
    assert.deepEqual(errors, []);
    console.log(`PASS IDF permissions: ${pages.join(', ')}`);
    await context.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}/?demo=1&role=super-admin#usuarios`);
  await page.getByRole('button', { name: 'Crear usuario', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Bitácora IDF general', exact: true }).waitFor();
  console.log('PASS independent IDF overview checkbox in user permissions');
  await page.keyboard.press('Escape');
  await page.goto(`${base}/?demo=1&role=super-admin#bitacora`);
  await page.getByRole('table', { name: 'Historial de movimientos y eventos registrados' }).waitFor();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of ['.project-audit-action-info strong', '.audit-actor-name', '.project-audit-target-pill', '.font-mono']) {
      assert.equal(await page.locator(`.project-audit-table ${selector}`).first().evaluate(el => getComputedStyle(el).fontSize), '18px');
    }
    assert.equal(await page.locator('.project-audit-action-info small').first().evaluate(el => getComputedStyle(el).fontSize), '16px');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'System log scroll must stay inside the page');
  }
  console.log('PASS readable system and IDF logs on mobile and desktop');
} finally {
  await browser.close();
}
