import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173'}/?demo=1`);
  await page.evaluate(async () => (await import('/tests/scroll-harness.jsx')).mount());
  const table = page.locator('.table-panel');
  await expect(table.locator('.loading-state')).toContainText('Consultando');
  await page.waitForTimeout(13000);
  await expect(table.locator('.loading-state')).toBeVisible();
  await expect(table.locator('.empty-state')).toHaveCount(0);
  await page.evaluate(() => window.completeQuery(350));
  await expect(table.locator('tbody tr')).toHaveCount(100);
  const assertScrollContained = async () => {
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('.table-scroll');
      const status = list.querySelector('[role="status"]');
      const contentEnd = document.querySelector('#custom-list').getBoundingClientRect().bottom + scrollY;
      return { contained: status.offsetParent === list,
        documentEnd: document.documentElement.scrollHeight, contentEnd: Math.max(innerHeight, contentEnd) };
    });
    expect(geometry.contained, 'El estado oculto debe posicionarse dentro de la lista').toBe(true);
    expect(geometry.documentEnd, 'Las filas recortadas no deben alargar el scroll de la página').toBeLessThanOrEqual(Math.ceil(geometry.contentEnd) + 1);
  };
  await assertScrollContained();
  await expect(table.locator('.pagination')).toHaveCount(0);
  for (let i = 0; i < 12; i++) { await table.locator('.table-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(100); }
  await expect(table.locator('tbody tr').last()).toContainText('Equipo 350');
  await expect(table.locator('tbody tr')).toHaveCount(100);
  await assertScrollContained();
  for (let i = 0; i < 12; i++) { await table.locator('.table-scroll').evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(100); }
  await expect(table.locator('tbody tr').first()).toContainText('Equipo 1');
  const custom = page.locator('#custom-list');
  for (let i = 0; i < 6; i++) { await custom.evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(100); }
  await expect(custom.locator('p')).toHaveCount(125);
  await page.evaluate(() => window.completeQuery(0));
  await expect(table.locator('.empty-state')).toBeVisible();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: slow loading, empty results, forward/backward table window, automatic custom lists.');
} finally { await browser.close(); }

