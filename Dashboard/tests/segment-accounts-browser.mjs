import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1687, height: 882 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = createDemo();
  const segment = { ...data.segments[0], name: 'SSID-Quetzacoatl', interface: 'SSID-Quetzacoatl', subnet: '15.40.1.0/24' };
  data.segments = [segment];
  data.devices = [{ name: 'Equipo observado', ip: '15.40.1.10', status: 'online', interface: segment.interface }];
  const accounts = [
    { username: 'sin.equipo', fullName: 'Persona sin dispositivo', department: 'Sistemas', telephone: '5551234567', id: 17, position: 'Analista', description: 'Cuenta institucional', email: 'persona@example.test', status: 1, accessRoleProfile: '__SSID-Quetzacoatl', devices: [] },
    { username: 'dos.equipos', fullName: 'Persona con equipos', department: 'Redes', status: 0, accessRoleProfile: '__SSID-Quetzacoatl', devices: [{ deviceName: 'Laptop', deviceMac: '00:11:22:33:44:55', deviceCategory: 'Computer', deviceOS: 'Windows', lastAccessDeviceSSID: 'Quetzacoatl', lastAccessLocation: 'IDF-2 / 1/1/12', lastAccessDeviceName: 'AP-12', activeStatus: 'Actived', forti: { name: 'PC-Redes', ip: '15.40.1.12', status: 'online', vendor: 'HP', interface: 'SSID-Quetzacoatl', fortigate: 'FG-Principal', serial: 'SERIE-123' } }, { deviceName: 'Celular', deviceMac: '11:22:33:44:55:66', accessRoleProfile: '__SSID-Ehecatl', deviceOS: 'Android' }] },
    { username: 'otro.perfil', accessRoleProfile: '__SSID-Ehecatl', status: 1, devices: [] },
  ];
  let role = 'super-admin';
  let complete = true;
  let failure = false;
  let accountCalls = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/altas/omnivista') {
      accountCalls++;
      return failure ? route.fulfill({ status: 503, json: { error: 'Servicio no disponible' } })
        : route.fulfill({ json: { success: true, data: { users: accounts, sources: { users: { status: 200, complete }, company_properties: { status: 200, complete }, fortigate: { status: complete ? 200 : 503, complete } } } } });
    }
    const payload = path === '/api/auth/session' ? { user: { id: 'accounts-test', name: 'Prueba', role }, capabilities: ['dashboard.read', 'inventory.read'] }
      : path === '/api/networks' ? { networks: data.segments, partial: false }
      : path === '/api/dashboard/preferences' ? { principal_segments: null }
      : path === '/api/forti/network/dhcp-pools' ? { data: { pools: data.segments } }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:4174';
  await page.goto(`${base}/`);
  await page.locator('.segment-card').getByRole('button', { name: 'Ver cuentas', exact: true }).click();
  const panel = page.locator('.segment-devices-panel');
  await expect(panel.getByRole('heading', { name: 'Cuentas en SSID-Quetzacoatl' })).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('group', { name: 'Vista del segmento' })).toHaveCount(0);
  await expect(panel.getByText('2 cuentas', { exact: true })).toBeVisible();
  await expect(panel.getByText('otro.perfil', { exact: true })).toHaveCount(0);
  const row = panel.locator('tbody tr').filter({ hasText: 'dos.equipos' });
  await expect(row.getByRole('cell', { name: 'Inactiva', exact: true })).toBeVisible();
  await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await panel.getByLabel('Dispositivos asociados', { exact: true }).selectOption('without');
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await panel.getByRole('button', { name: 'sin.equipo', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByText('persona@example.test', { exact: true })).toBeVisible();
  await expect(dialog.getByText('5551234567', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Cuenta institucional', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Sin dispositivos registrados' })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.getByLabel('Dispositivos asociados', { exact: true }).selectOption('');
  await panel.getByRole('searchbox').fill('Redes');
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await panel.locator('tbody tr').filter({ hasText: 'dos.equipos' }).getByRole('cell', { name: 'Persona con equipos', exact: true }).click();
  await expect(dialog.getByText('Laptop', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Celular', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Coincide por MAC en FortiGate', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sin coincidencia en FortiGate', { exact: true })).toBeVisible();
  await expect(dialog.getByText('FG-Principal', { exact: true })).toBeVisible();
  await expect(dialog.getByText('SERIE-123', { exact: true })).toBeVisible();
  await expect(dialog.getByText('AP-12', { exact: true })).toBeVisible();
  await expect(dialog.getByText('__SSID-Ehecatl', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: '/tmp/sgrs-account-complete-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1687, height: 882 });
  await page.keyboard.press('Escape');
  await panel.getByRole('searchbox').fill('');
  complete = false;
  await panel.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(panel.getByText('Consulta de cuentas incompleta', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sin confirmar', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'dos.equipos', exact: true }).click();
  await expect(dialog.getByText('Cotejo pendiente', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sin coincidencia en FortiGate', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  failure = true;
  await panel.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(panel.getByText('No se pudieron actualizar las cuentas', { exact: true })).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  assert.equal(accountCalls, 3);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
  assert.deepEqual(violations.map(v => v.id), []);
  await page.screenshot({ path: '/tmp/sgrs-segment-accounts-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1687, height: 882 });
  role = 'viewer';
  await page.reload();
  await page.locator('.segment-card').getByRole('button', { name: 'Ver cuentas', exact: true }).click();
  await expect(panel.getByText('Tu perfil no permite consultar el directorio de cuentas.', { exact: true })).toBeVisible();
  assert.equal(accountCalls, 3, 'Viewer must not request account identities');
  assert.deepEqual(errors, []);
  console.log('PASS: accounts without devices, distinct account state, details, filters, partial results, retry, mobile accessibility, complete account details and per-device FortiGate cross-checks.');
} finally { await browser.close(); }
