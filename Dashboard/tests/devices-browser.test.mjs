import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ executablePath: '/opt/brave-bin/brave', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const data = createDemo();

  let role = 'super-admin';
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/session' ? { user: { id: 'test-user', name: 'Israel Garcia', username: 'vivaceash', role }, capabilities: ['dashboard.read', 'inventory.read', 'inventory.write', 'traffic.read'], roles: [] }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });

  const base = process.env.SGRS_TEST_URL || 'http://localhost:3000';
  await page.goto(`${base}/#dispositivos`);
  await page.waitForTimeout(1000);

  const heading = await page.textContent('h1');
  console.log('Heading:', heading);
  assert.equal(heading, 'Dispositivos de Red');

  const rows = await page.locator('table tbody tr').count();
  console.log('Number of device rows:', rows);
  assert(rows > 0, 'Must render device rows');

  // Click on the first row to test opening device detail
  console.log('Clicking first device row to verify modal...');
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(500);

  const modalOpen = await page.locator('dialog[open]').isVisible();
  console.log('Detail modal open:', modalOpen);
  assert.equal(modalOpen, true, 'Device detail modal must open on row click');

  assert.equal(errors.length, 0, `Browser errors detected: ${errors.join(', ')}`);
  console.log('ALL DEVICES PAGE TESTS PASSED!');
} finally {
  await browser.close();
}
