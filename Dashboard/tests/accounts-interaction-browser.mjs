import { chromium, expect } from '@playwright/test';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1687, height: 882 } });
  const data = createDemo();
  const users = [12, 2, 0].map(count => ({ username: `cuenta-${count}`, fullName: `Persona ${count}`, department: 'Pruebas', status: 1, devices: Array.from({ length: count }, (_, id) => ({ id, deviceName: `Equipo ${id}` })) }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/session' ? { user: { id: 'test', name: 'Prueba', username: 'test', role: 'super-admin' }, capabilities: ['dashboard.read', 'inventory.read', 'inventory.export'], roles: [] }
      : path === '/api/altas/omnivista' ? { success: true, data: { users } }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
      : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:5175'}/#altas`);
  const table = page.getByRole('region', { name: 'Todas las cuentas de usuarios OmniVista', exact: true });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  const header = table.getByRole('columnheader', { name: 'Dispositivos', exact: true });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(rows.first()).toContainText('cuenta-0');
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(rows.first()).toContainText('cuenta-12');

  await rows.first().locator('td').nth(3).click();
  await expect(page.getByRole('dialog', { name: 'Detalle de cuenta cuenta-12' })).toBeVisible();
  const detail = page.getByRole('dialog', { name: 'Detalle de cuenta cuenta-12' });
  await detail.getByRole('heading', { name: 'Detalle de cuenta cuenta-12' }).click();
  await expect(detail).toBeVisible();
  const bounds = await detail.boundingBox();
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(10, 400);
  await page.mouse.up();
  await expect(detail).toBeVisible();
  for (const position of [{ x: 10, y: 400 }, { x: 1675, y: 400 }, { x: 800, y: 5 }, { x: 800, y: 875 }]) {
    await page.mouse.click(position.x, position.y);
    await expect(detail).not.toBeVisible();
    await rows.first().locator('td').nth(3).click();
    await expect(detail).toBeVisible();
  }
  await page.getByRole('button', { name: 'Cerrar diálogo' }).click();
  await rows.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Detalle de cuenta cuenta-12' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar diálogo' }).click();
  await rows.first().focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: 'Detalle de cuenta cuenta-12' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar diálogo' }).click();

  await rows.first().getByRole('button', { name: 'Organizar cuenta cuenta-12' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Clasificación privada · cuenta-12' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Detalle de cuenta cuenta-12' })).not.toBeVisible();
  const annotation = page.getByRole('dialog', { name: 'Clasificación privada · cuenta-12' });
  await page.mouse.click(10, 400);
  await expect(annotation).not.toBeVisible();
  await rows.first().getByRole('button', { name: 'Organizar cuenta cuenta-12' }).click();
  let finishSave;
  const saving = new Promise(resolve => { finishSave = resolve; });
  await page.route('**/api/altas/annotation', async route => {
    await saving;
    await route.fulfill({ json: { success: false, error: 'Respuesta de prueba' } });
  });
  await annotation.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(annotation.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled();
  await page.mouse.click(10, 400);
  await expect(annotation).toBeVisible();
  finishSave();
  await expect(annotation.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(annotation).not.toBeVisible();
  console.log('PASS: numeric sorting, row interactions, outside dismissal on all sides, inside/drag protection, busy lock and Escape.');
} finally {
  await browser.close();
}
