import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.SGRS_MOBILE_TEST_ORIGIN;
assert.ok(origin && process.env.SGRS_MOBILE_TEST_TOKEN, 'Run through tests/mobile-report-server.py');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const submissionIds = [];
  let confirmedRetries = 0;
  await page.route('**/api/mobile-report', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submissionIds.push(route.request().postDataJSON().incident.id);
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const saved = await response.json();
    assert.equal(saved.status, 'success');
    if (submissionIds.length === 1) {
      // Persist normally, then simulate a connection that loses the acknowledgement.
      return route.fulfill({ response, json: {} });
    }
    assert.equal(saved.duplicate, true, 'Retry must recover the original saved report');
    confirmedRetries++;
    return route.fulfill({ response });
  });
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  const url = new URL(origin);
  url.searchParams.set('mobile', '1');
  url.searchParams.set('idf', 'idf-6');
  url.searchParams.set('token', process.env.SGRS_MOBILE_TEST_TOKEN);
  await page.goto(url.toString());
  await expect(page.getByRole('heading', { name: 'IDF 06', exact: true })).toBeVisible();
  assert.equal(await page.locator('.login-page').count(), 0);
  const form = page.locator('.mobile-report-form');
  await form.locator('input[autocomplete="name"]').fill('Verificación LAN');
  await form.locator('input[type="number"]').fill('55');
  await form.locator('textarea').fill('Prueba aislada de reporte móvil');
  await page.getByRole('button', { name: 'Enviar reporte', exact: true }).click();
  await expect(page.getByText('Ingresa una temperatura entre 10 y 42 °C.', { exact: true })).toBeVisible();
  assert.equal(posts, 0, 'Invalid temperatures must not be sent to the server');
  await expect(form.locator('input[type="number"]')).toHaveAttribute('aria-invalid', 'true');
  await form.locator('input[type="number"]').fill('23.5');
  await form.locator('textarea').fill('');
  await page.getByRole('button', { name: 'Enviar reporte', exact: true }).click();
  await expect(page.getByText('Describe la incidencia.', { exact: true })).toBeVisible();
  assert.equal(posts, 0);
  await form.locator('textarea').fill('Prueba aislada de reporte móvil');
  await page.getByRole('button', { name: 'Enviar reporte', exact: true }).click();
  await expect(page.getByText('El servidor no confirmó el guardado. Vuelve a enviar el reporte.', { exact: true })).toBeVisible();
  assert.equal(await page.locator('.mobile-success').count(), 0, 'Success requires a server acknowledgement');
  await expect(form.locator('textarea')).toHaveValue('Prueba aislada de reporte móvil');
  await page.getByRole('button', { name: 'Enviar reporte', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reporte guardado correctamente', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-success[role="status"]')).toBeVisible();
  await expect(page.locator('.mobile-success')).toHaveCSS('background-color', 'rgb(236, 253, 243)');
  assert.equal(posts, 2);
  assert.equal(submissionIds[0], submissionIds[1]);
  assert.equal(confirmedRetries, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: LAN QR without login; field validation; green confirmed success; retry without duplicate records');
} finally {
  await browser.close();
}
