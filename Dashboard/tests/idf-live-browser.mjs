import { chromium, expect } from '@playwright/test';
import { createDemo } from '../src/demo.mjs';
const browser = await chromium.launch({ executablePath: process.env.SGRS_BROWSER || '/opt/brave-origin-bin/brave', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.clock.install();
  const data = createDemo();
  const identity = { user: { id: 'live-test', name: 'Operador', role: 'admin', version: 1 }, csrf: 'test', allowed_pages: ['idf', 'bitacora-idf'], capabilities: ['idf.read', 'activity.read', 'inventory.read'] };
  let reportReads = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: identity });
    if (path === '/api/reports') reportReads++;
    const value = path.endsWith('dhcp-leases') ? { data: [] } : data[path.split('/').pop()] ?? {};
    return route.fulfill({ json: value });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000'}/#idf`);
  await page.getByRole('table', { name: 'Bitácora consolidada de visitas a IDFs' }).waitFor();
  data.reports['idf-3'] = { incidents: [{ id: 'live-report', title: 'Registro remoto nuevo', description: 'Visita desde otro dispositivo', date: new Date().toISOString(), status: 'open', tech: 'Otro operador', temp: 23 }] };
  await page.clock.fastForward(60000);
  await expect(page.getByText('Registro remoto nuevo', { exact: true })).toBeVisible({ timeout: 12000 });
  data.reports['idf-3'].incidents[0].status = 'resolved';
  await page.clock.fastForward(60000);
  await expect(page.getByRole('row').filter({ hasText: 'Registro remoto nuevo' }).getByText('Resuelto', { exact: true })).toBeVisible({ timeout: 12000 });
  console.log(`PASS: remote report creation and resolution appear without reload (${reportReads} reads).`);
} finally { await browser.close(); }
