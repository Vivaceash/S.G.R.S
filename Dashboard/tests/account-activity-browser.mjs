import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const base = process.env.SGRS_TEST_URL || 'http://localhost:3000';
try {
  for (const width of [1627, 425]) {
    const page = await browser.newPage({ viewport: { width, height: 882 } });
    await page.clock.install();
    const now = Date.now();
    const users = [
      { activityAssessment: { status: 'inactive', reason: 'Sin autenticación ni coincidencia en Forti' }, username: 'ana.temporal', fullName: 'Ana', description: 'Oficio', department: 'Urgencias', dateOfEffective: now + 3600000, devices: [{ deviceMac: 'AA:BB:CC:DD:EE:01', deviceOS: 'Android' }, { deviceMac: 'AA:BB:CC:DD:EE:02', deviceOS: 'iOS' }] },
      { username: 'bruno.temporal', fullName: 'Bruno', description: 'Temporal', department: 'Sistemas', dateOfEffective: now + 2 * 86400000, devices: [{ deviceMac: 'AA:BB:CC:DD:EE:03', deviceOS: 'Windows 11' }, { deviceMac: 'AA:BB:CC:DD:EE:04', deviceOS: 'macOS' }] },
      { username: 'carla.vencida', fullName: 'Carla', description: 'Oficio', dateOfEffective: now - 1000, devices: [] },
      { username: 'dora.planta', fullName: 'Dora', description: 'Plantilla', devices: [{ deviceMac: 'AA:BB:CC:DD:EE:05', deviceName: 'Apple' }] },
    ];
    let reads = 0;
    let accountReads = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      assert.equal(route.request().method(), 'GET', 'Widgets never write to APIs');
      const path = new URL(route.request().url()).pathname;
      if (path !== '/api/auth/session') reads++;
      if (path === '/api/altas/omnivista') accountReads++;
      const body = path === '/api/auth/session' ? { user: { id: 'altas-widgets-test', role: 'admin', name: 'Prueba' }, allowed_pages: ['altas'], allowed_submodules: ['altas:all', 'altas:oficios'], capabilities: ['dashboard.read'] }
        : path === '/api/altas/omnivista' ? { success: true, data: { users, sources: { users: { complete: true }, company_properties: { complete: false, unassociated: 4 } } } }
        : path.endsWith('dhcp-pools') ? { data: { pools: [] } } : path.endsWith('dhcp-leases') ? { data: [] }
        : ['/api/devices', '/api/ips'].includes(path) ? [] : {};
      return route.fulfill({ json: body });
    });
    await page.goto(`${base}/#altas`);
    const table = page.locator('.altas-accounts-list');
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('[data-widget="altas-temporary"] .altas-widget-value > strong')).toHaveText('3');
    await expect(page.locator('[data-widget="altas-device-total"] .altas-widget-value > strong')).toHaveText('5');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('columnheader', {name: 'Actividad por cotejo'})).toBeVisible();
    await expect(table.getByText('Inactiva por cotejo', {exact:true})).toHaveCount(1);
    const initialReads = reads;
    await page.getByRole('button', {name: 'Filtrar Inactivas por cotejo', exact:true}).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.locator('tbody')).toContainText('ana.temporal');
    assert.equal(reads, initialReads);
    await page.getByRole('button', {name:'Quitar filtro', exact:true}).click();
    await page.getByRole('button', {name:'Filtrar Actividad sin verificar', exact:true}).click();
    await expect(table.locator('tbody tr')).toHaveCount(3);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: inactivity evidence column, widgets and local filtering at desktop/mobile; no additional API calls.');
} finally { await browser.close(); }
