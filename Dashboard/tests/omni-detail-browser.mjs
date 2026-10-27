import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1687, height: 882 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = createDemo();
  data.devices = [{ name: 'DESKTOP-QQDISCT', hostname: 'DESKTOP-QQDISCT',
    mac: 'd8:9c:67:78:94:31', ip: '15.40.1.24', status: 'online', type: 'Computadora',
    interface: 'SSID-Quetzacoatl', serial: 'DESKTOP-QQDISCT', os: 'Windows', omnivista: null }];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let result = { status: 'matched', omnivista: { matched: true, device_name: 'DESKTOP-QQDISCT',
    full_name: 'Usuario de prueba', department: 'Sistemas', position: 'Soporte', description: 'Soporte',
    os: 'Windows', location: 'MDF -> 2/1/41', ssid: 'SSID-Quetzacoatl',
    account: 'usuario.prueba', account_effective_at: 1720000000000, status: 'Online' } };
  let calls = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/devices/omnivista') {
      calls++;
      await pending;
      return route.fulfill({ json: result });
    }
    const payload = path === '/api/auth/session'
      ? { user: { id: 'omni-detail-test', name: 'Prueba', role: 'super-admin' }, capabilities: ['dashboard.read', 'inventory.read'] }
      : path === '/api/forti/network/dhcp-pools' ? { data: { pools: data.segments } }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://localhost:3000'}/#dispositivos`);
  await page.locator('tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click();
  const modal = page.locator('dialog[open]');
  await expect(modal.getByText('Consultando OmniVista para cotejar este dispositivo…')).toBeVisible();
  release();
  await expect(modal.getByText('Información cotejada en OmniVista 2500')).toBeVisible();
  await expect(modal.getByText('Usuario de prueba', { exact: true })).toHaveCount(1);
  await expect(modal.getByText('Soporte', { exact: true })).toHaveCount(1);
  await expect(modal.locator('dd').filter({ hasText: /^DESKTOP-QQDISCT$/ })).toHaveCount(1);
  await expect(modal.getByText('usuario.prueba', { exact: true })).toHaveCount(1);
  await expect(modal.getByText('Windows', { exact: true })).toHaveCount(1);
  await expect(modal.getByText('MDF -> 2/1/41', { exact: true })).toHaveCount(1);
  await expect(modal.getByText('SSID-Quetzacoatl', { exact: true })).toHaveCount(1);
  await expect(modal.locator('.forti-detail-box')).toHaveCount(0);
  await expect(modal.locator('.omni-detail-box dt', { hasText: 'Estado en OmniVista' })).toHaveCount(0);
  await expect(modal.locator('.omni-detail-box dt', { hasText: 'Teléfono' })).toHaveCount(0);
  await expect(modal.getByText('Sistemas', { exact: true })).toHaveCount(1);
  assert.equal(calls, 1, 'The detail must update without refetching the device list');
  await page.keyboard.press('Escape');

  result = { status: 'matched', omnivista: { ...result.omnivista,
    device_name: 'equipo-alternativo', account: 'otra.cuenta',
    os: 'Linux', ssid: 'SSID-Alterno', description: 'Descripción adicional', status: 'Offline' } };
  data.devices[0].user = 'usuario.fortigate';
  await page.reload();
  await page.locator('tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click();
  await expect(modal.getByText('equipo-alternativo', { exact: true })).toBeVisible();
  await expect(modal.getByText('otra.cuenta', { exact: true })).toBeVisible();
  await expect(modal.getByText('Linux', { exact: true })).toBeVisible();
  await expect(modal.getByText('SSID-Alterno', { exact: true })).toBeVisible();
  await expect(modal.getByText('Descripción adicional', { exact: true })).toBeVisible();
  await expect(modal.locator('.omni-detail-box dt', { hasText: 'Estado en OmniVista' })).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Mobile detail must fit its dialog');
  await page.keyboard.press('Escape');

  result = { status: 'not_found', omnivista: null };
  await page.locator('tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click();
  await expect(modal.getByText('No se encontró esta MAC en el catálogo de dispositivos de OmniVista.')).toBeVisible();
  result = { status: 'unavailable', omnivista: null };
  await modal.getByRole('button', { name: 'Volver a consultar OmniVista' }).click();
  await expect(modal.getByText('No se pudo consultar OmniVista. Puedes volver a intentar.')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: a cold device row updates with OmniVista details; missing match and service errors remain visible.');
} finally {
  await browser.close();
}
