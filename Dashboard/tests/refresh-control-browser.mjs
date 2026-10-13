import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.clock.install();
  const data = createDemo();
  let deviceReads = 0;
  await page.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET');
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/session' ? { user: { id: 'refresh-test', name: 'Prueba', role: 'admin' }, capabilities: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read'], csrf: 'mock' }
      : path === '/api/devices' ? (deviceReads++, data.devices)
      : path === '/api/idfs' ? data.idfs : path === '/api/ips' ? data.ips
      : path === '/api/reports' ? data.reports : path === '/api/health' ? data.health
      : path === '/api/forti/network/dhcp-pools' ? { data: { pools: data.segments } }
      : path === '/api/forti/network/dhcp-leases' ? { data: [] }
      : path === '/api/audit' ? { events: data.audit } : { principal_segments: null, modules: [] };
    return route.fulfill({ json: body });
  });
  await page.goto('http://127.0.0.1:3000/#resumen');
  const button = page.locator('.refresh-countdown');
  await expect(button).toBeEnabled();
  await expect(button.locator('circle')).toHaveCount(2);
  await expect(button.locator('.refresh-ring-progress')).toHaveAttribute('stroke-dashoffset', '0');
  await page.clock.fastForward(30000);
  await expect(button).toHaveAttribute('data-remaining', '30');
  await expect(button.locator('.refresh-ring-progress')).toHaveAttribute('stroke-dashoffset', '-30');
  const initial = deviceReads;
  await button.click();
  await expect.poll(() => deviceReads).toBe(initial + 1);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('data-remaining', '60');
  await page.clock.fastForward(60000);
  await expect.poll(() => deviceReads).toBe(initial + 2);
  await expect(button).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 700 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('tmp/refresh', { recursive: true });
  await page.screenshot({ path: 'tmp/refresh/mobile.png' });
  console.log('Aro continuo, cuenta regresiva, actualización manual y automática: OK');
} finally { await browser.close(); }
