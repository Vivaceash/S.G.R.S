import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000';
const output = 'tmp/responsive';
await mkdir(output, { recursive: true });
const failures = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Prueba aislada' } }));
async function check(label, width) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    elements: [...document.querySelectorAll('main *, dialog[open] *')].filter(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= innerWidth + 1) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return false;
      }
      return true;
    }).slice(0, 12).map(el => ({ class: el.className, text: el.textContent.slice(0, 50) })),
  }));
  if (result.overflow || result.elements.length) failures.push({ label, width, ...result });
}
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['resumen', 'dispositivos', 'disponibilidad', 'gestion-meztli', 'bitacora', 'idf', 'bitacora-idf', 'aps', 'cctv', 'altas', 'soporte', 'usuarios', 'conexiones', 'entrada']) {
      await page.goto(`${base}/?demo=1&role=super-admin#${route}`);
      await page.locator('main').waitFor();
      await page.waitForTimeout(180);
      await check(route, width);
      const tabs = await page.getByRole('tab').all();
      for (let i = 0; i < tabs.length; i++) {
        await page.getByRole('tab').nth(i).click();
        await page.waitForTimeout(100);
        await check(`${route}/tab-${i}`, width);
      }
      if (width === 390) await page.screenshot({ path: `${output}/${route}.png`, fullPage: true });
    }
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(`${base}/?demo=1&role=super-admin#usuarios`);
    await page.getByRole('button', { name: 'Crear usuario', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await check('usuarios/formulario', width);
    const bounds = await dialog.boundingBox();
    if (bounds.x < 0 || bounds.x + bounds.width > width || bounds.height > 700) failures.push({ label: 'usuarios/dialog', width, bounds });
    await page.screenshot({ path: `${output}/usuario-form-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.goto(`${base}/?demo=1&role=super-admin#disponibilidad`);
    await page.getByRole('button', { name: '▦ Matriz', exact: true }).click();
    await check('disponibilidad/matriz', width);
    await page.goto(`${base}/?demo=1&role=super-admin#idf`);
    await page.getByRole('button', { name: /^IDF-03:/ }).click();
    for (const name of ['Inventario', 'Código QR']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await check(`idf/${name}`, width);
    }
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ failures, errors }, null, 2));
  console.log(JSON.stringify({ failures, errors }, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
