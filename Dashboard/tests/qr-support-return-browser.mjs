import { chromium, expect } from '@playwright/test';

// All API traffic is mocked: this check never logs in or writes real records.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  let signedIn = false;
  const user = { id: 'mock-support', name: 'Soporte de prueba', role: 'soporte', allowed_pages: ['soporte'] };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/mobile-report') body = { idf: { id: 'idf-3', name: 'IDF 3', zone: 'Planta baja' } };
    else if (path === '/api/auth/login') { signedIn = true; body = { user, csrf: 'mock', capabilities: [], must_change_password: false }; }
    else if (path === '/api/auth/session') body = signedIn ? { user, csrf: 'mock', capabilities: [] } : { user: null, setup_required: false };
    else if (path === '/api/support/inventory') body = { items: [{ id: 'toner', description: 'Tóner', quantity: 4, unit: 'piezas' }, { id: 'cable', description: 'Cable HDMI', quantity: 2, unit: 'piezas' }] };
    else throw new Error(`Unexpected API request: ${path}`);
    await route.fulfill({ json: body });
  });
  const url = 'http://127.0.0.1:3000/?mobile=1&idf=idf-3&token=mock-qr';
  await page.goto(url.replace('idf=idf-3', 'idf=idf-4'));
  await expect(page.getByRole('button', { name: 'Enviar reporte', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-support-entry')).toHaveCount(0);
  await page.goto(url);
  await page.getByRole('button', { name: 'Iniciar sesión de soporte', exact: true }).click();
  await page.locator('input[autocomplete="username"]').fill('mock');
  await page.locator('input[autocomplete="current-password"]').fill('mock-password');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByText('BITÁCORA DE SOPORTE', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { name: 'IDF 3', exact: true })).toBeVisible();
  const options = page.locator('.mobile-inventory-picker option');
  await expect(options).toHaveText(['Selecciona un artículo', 'Tóner', 'Cable HDMI']);
  await page.getByRole('searchbox', { name: 'Buscar artículo por nombre' }).fill('Cable');
  await expect(options).toHaveText(['Selecciona un artículo', 'Cable HDMI']);
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(options).toHaveCount(3);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.goto(url.replace('idf=idf-3', 'idf=idf-4'));
  await expect(page.getByRole('button', { name: 'Enviar reporte', exact: true })).toBeVisible();
  await expect(page.getByText('BITÁCORA DE SOPORTE', { exact: true })).toHaveCount(0);
  console.log('PASS: QR login returns to same IDF, inventory filtering and name-only options; no real API writes.');
} finally {
  await browser.close();
}
