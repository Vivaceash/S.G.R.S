import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1687, height: 882 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const users = [
    { username: 'natalia.cabrera', fullName: 'Natalia Cabrera', department: 'Sistemas', email: 'natalia@example.test', telephone: '1234', accessRoleProfile: '__SSID-Ehecatl', status: 'online', devices: [{ deviceMac: 'AA:BB:CC:DD:EE:01', deviceName: 'Laptop Natalia', lastAccessLocation: 'MDF', cotejo: 'encontrado', forti: { ip: '10.0.0.2', hostname: 'LAPTOP-NATALIA', os: 'Windows', status: 'online' } }] },
    { username: 'otra.cuenta', accessRoleProfile: '__SSID-Otra', devices: [] },
  ];
  users[0].devices[0].deviceCategory = 'Computer';
  users[0].devices.push({ deviceName: 'Móvil Natalia', deviceMac: 'AA:BB:CC:DD:EE:02', deviceCategory: 'Mobile', deviceOS: 'MacOS' });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/auth/session' ? { user: { id: 'account-detail-test', role: 'super-admin', name: 'Prueba' }, allowed_pages: ['altas'], allowed_submodules: ['altas:all'], capabilities: ['dashboard.read'] }
      : path === '/api/altas/omnivista' ? { success: true, data: { users, sources: {} } }
      : path.endsWith('dhcp-pools') ? { data: { pools: [] } } : path.endsWith('dhcp-leases') ? { data: [] } : ['/api/devices', '/api/ips'].includes(path) ? [] : {} });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://localhost:3000'}/#altas`);
  const table = page.locator('.altas-accounts-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.getByRole('combobox', { name: 'Departamento', exact: true }).selectOption('Sistemas');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody')).toContainText('natalia.cabrera');
  await table.getByRole('combobox', { name: 'Departamento', exact: true }).selectOption('');
  await table.getByRole('button', { name: 'Organizar cuenta natalia.cabrera', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await table.getByRole('button', { name: 'natalia.cabrera', exact: true }).click();
  const modal = page.locator('dialog[open]');
  await expect(modal.locator('.account-device-card').first().locator('.account-device-symbol .lucide-laptop')).toHaveCount(1);
  await expect(modal.locator('.account-device-card').nth(1).locator('.account-device-symbol .lucide-smartphone')).toHaveCount(1);
  await expect(modal.locator('.account-device-card').nth(1).locator('.account-device-symbol .lucide-laptop')).toHaveCount(0);

  for (const value of ['Natalia Cabrera', 'natalia@example.test', '1234', 'Laptop Natalia', '10.0.0.2', 'LAPTOP-NATALIA', 'MDF']) await expect(modal.getByText(value, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await table.getByRole('combobox', { name: 'Filtrar por red' }).selectOption('__SSID-Otra');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await table.getByRole('button', { name: 'otra.cuenta', exact: true }).click();
  await expect(modal.getByText('Sin dispositivos asociados', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.keyboard.press('Escape');
  await table.getByRole('combobox', { name: 'Filtrar por red' }).selectOption('');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.getByRole('combobox', { name: 'Filtrar por red' }).selectOption('__SSID-Otra');
  await table.getByRole('searchbox').fill('otra.cuenta');
  await page.getByRole('button', { name: 'Filtrar natalia.cabrera', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody')).toContainText('natalia.cabrera');
  await expect(table.getByRole('searchbox')).toHaveValue('');
  await expect(table.getByRole('combobox', { name: 'Filtrar por red' })).toHaveValue('');
  for (const width of [1687, 375]) {
    await page.setViewportSize({ width, height: 882 });
    const fits = await table.getByRole('combobox', { name: 'Filtrar por red' }).evaluate(el => {
      const parent = el.closest('th').getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = getComputedStyle(el).font;
      const textWidth = context.measureText(el.selectedOptions[0].textContent).width;
      return rect.left >= parent.left && rect.right <= parent.right && rect.width >= textWidth + 40;
    });
    assert.equal(fits, true, 'Network selector must show its full label and fit inside its header');
  }
  await page.setViewportSize({ width: 1687, height: 882 });
  await table.screenshot({ path: '/tmp/altas-network-toolbar.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: account details, Forti match, empty devices, network filter and mobile dialog.');
} finally { await browser.close(); }
