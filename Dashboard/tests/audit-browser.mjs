import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { ROLE_PAGE_DEFAULTS, defaultSubmodules, dateTime } from '../src/domain.mjs';
import { ROLE_CAPABILITIES } from '../src/user-permissions.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1687, height: 882 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = createDemo();
  const user = { id: 'audit-test', name: 'Técnico de prueba', role: 'super-admin' };
  const pages = ROLE_PAGE_DEFAULTS['super-admin'];
  const historical = Date.parse('2026-09-08T19:55:00-06:00');
  let events = [
    { id: 1, action: 'user.updated', actor_name: 'Prueba', created_at: '2026-09-08T19:55:00-06:00', target_label: 'Usuario de prueba', details: JSON.stringify({ before: { username: 'prueba', role: 'viewer' }, after: { username: 'prueba', role: 'viewer' } }) },
    { id: 2, action: 'idf.report.created', actor_name: 'Prueba', created_at: String(historical / 1000), target: 'idf-3:IDF-12345678-1234-1234-1234-123456789abc', details: 'Revisión histórica' },
    { id: 3, action: 'idf.report.created', actor_name: 'Prueba', created_at: null, original_date: 'Hoy, 14:15', source: 'report-history', target: 'idf-3:legacy', details: 'Reporte sin fecha calendario' },
    { id: 4, action: 'user.updated', actor_name: 'Prueba', created_at: historical, target_label: 'Usuario modificado', details: JSON.stringify({ before: { role: 'viewer' }, after: { role: 'admin' } }) },
  ];
  let auditReads = 0;
  let reportWrites = 0;
  let documents = 0;
  page.on('request', request => { if (request.resourceType() === 'document') documents++; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/reports' && route.request().method() === 'POST') {
      reportWrites++;
      const body = route.request().postDataJSON();
      const incident = { ...body.incident, date: '2026-10-27T16:20:13Z', tech: user.name, actor_id: user.id };
      events = [{ id: 99, action: 'idf.report.created', created_at: 1793118013, actor_name: user.name, target: `idf-3:${incident.id}`, target_label: 'IDF Soporte · Reporte de incidencia', details: incident.description }, ...events];
      return route.fulfill({ json: { incident, telemetry: {} } });
    }
    if (path === '/api/audit') { auditReads++; return route.fulfill({ json: { events } }); }
    const body = path === '/api/auth/session' ? { user, allowed_pages: pages, allowed_submodules: defaultSubmodules(pages), capabilities: ROLE_CAPABILITIES['super-admin'], csrf: 'test' }
      : path === '/api/idfs' ? [{ id: 'idf-3', name: 'IDF Soporte', zone: 'Prueba', devices: [], incidents: [] }]
      : path === '/api/reports' ? {}
      : path === '/api/networks' ? { networks: [], sources: [], partial: false }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: body });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
  await page.goto(`${base}/#bitacora`);
  const table = page.locator('.project-audit-table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(table).not.toContainText('"before"');
  await expect(table).not.toContainText('12345678-1234');
  await expect(table.getByText(dateTime(new Date(historical)), { exact: true })).toHaveCount(3);
  await expect(table.getByText('Fecha no determinada', { exact: true })).toBeVisible();
  await expect(table.getByText('Se guardó la cuenta sin cambios en sus datos o permisos.', { exact: true })).toBeVisible();
  const changed = table.locator('tbody tr').filter({ hasText: 'Usuario modificado' });
  await changed.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Detalle del movimiento', exact: true });
  await expect(modal.getByText('Consulta', { exact: true })).toBeVisible();
  await expect(modal.getByText('Administrador', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await table.screenshot({ path: '/tmp/sgrs-audit-readable.png' });

  await page.goto(`${base}/#entrada?idf=idf-3`);
  await page.getByLabel('Temperatura (°C)', { exact: false }).fill('23');
  await page.getByLabel('Inconveniente detectado', { exact: false }).fill('Reporte panel de prueba');
  const readsBeforeSave = auditReads;
  const documentsBeforeSave = documents;
  await page.getByRole('button', { name: 'Enviar reporte de incidencia', exact: true }).click();
  await expect(page).toHaveURL(/#bitacora/);
  await expect(table.getByText('Reporte panel de prueba', { exact: true })).toBeVisible();
  assert.equal(reportWrites, 1);
  assert.ok(auditReads > readsBeforeSave, 'Returning from the panel report must refresh the audit feed');
  assert.equal(documents, documentsBeforeSave, 'The new event must appear without reloading the page');
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: historical dates, unknown dates, readable targets, structured changes and immediate audit refresh after a panel report; all APIs mocked.');
} finally { await browser.close(); }
