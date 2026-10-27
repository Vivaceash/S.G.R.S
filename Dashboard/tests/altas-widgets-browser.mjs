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
      { username: 'ana.temporal', fullName: 'Ana', description: 'Oficio', department: 'Urgencias', dateOfEffective: now + 3600000, devices: [{ deviceMac: 'AA:BB:CC:DD:EE:01', deviceOS: 'Android' }, { deviceMac: 'AA:BB:CC:DD:EE:02', deviceOS: 'iOS' }] },
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
    const initialReads = reads;
    await page.getByRole('button', { name: 'Filtrar Total temporales', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: 'Filtrar Android', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.locator('tbody')).toContainText('ana.temporal');
    await page.getByRole('button', { name: 'Quitar filtro', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await page.clock.fastForward(120000);
    assert.equal(reads, initialReads, 'Filters and countdowns must not query APIs');
    await page.getByRole('button', { name: 'Personalizar indicadores', exact: true }).click();
    const overlaps = await page.locator('.altas-compact-list').evaluateAll(cards => cards.filter(card => {
      const cell = card.closest('.dashboard-widget-cell');
      return card.getBoundingClientRect().bottom > cell.getBoundingClientRect().bottom + 1;
    }).length);
    assert.equal(overlaps, 0, 'List cards must fit below their editing controls without overflowing their cells');
    const listWidth = page.getByRole('combobox', { name: 'Ancho de Sistemas operativos', exact: true });
    const listCell = page.locator('[data-widget="altas-platforms"]');
    await listWidth.selectOption('4');
    const compactWidth = (await listCell.boundingBox()).width;
    await listWidth.selectOption('12');
    const fullWidth = (await listCell.boundingBox()).width;
    if (width > 1000 && fullWidth < compactWidth * 2.8) throw new Error('El ancho de la lista no respeta la selección');
    await listWidth.selectOption('4');

    await expect(page.locator('.widget-catalog > article')).toHaveCount(23);
    await page.getByRole('button', { name: 'Agregar Dispositivos sin cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar diseño', exact: true }).click();
    await expect(page.locator('[data-widget="altas-unassociated"] .altas-widget-value > strong')).toHaveText('—');
    await page.getByRole('button', { name: 'Filtrar macOS', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.locator('tbody')).toContainText('bruno.temporal');
    await page.reload();
    await expect(page.locator('[data-widget="altas-platforms"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Usuarios próximos a dar de baja \(\d+\)$/, exact: true })).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await page.waitForLoadState('networkidle');
    await page.clock.fastForward(1000);
    const beforeRefresh = accountReads;
    await page.locator('.header-refresh').click();
    await expect.poll(() => accountReads).toBe(beforeRefresh + 1);
    await expect(table.locator('tbody tr')).toHaveCount(4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: 23 widgets, counts, filters, customization persistence, partial data and no polling`);
    await page.close();
  }
} finally { await browser.close(); }
