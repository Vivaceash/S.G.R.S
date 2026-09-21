import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ executablePath: '/opt/brave-bin/brave', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const data = createDemo();
  data.devices = Array.from({ length: 125 }, (_, i) => ({
    name: `Local ${i}`,
    ip: `192.168.10.${i + 1}`,
    status: 'online',
    os: i % 2 === 0 ? 'Windows 11' : 'Android 14',
    interface: data.segments[0].interface,
    omnivista: i % 2 === 0 ? {
      matched: true,
      mac: `001A2B3C${String(i).padStart(4, "0")}`,
      device_name: `ov-device-${i}`,
      account: `user.${i}`,
      location: `IDF-0${(i % 5) + 1} -> 1/1/${20 + i}`,
      ap_name: `AP-0${i}`,
      ssid: data.segments[0].name,
      category: 'Computer',
      family: 'Dell',
      os: 'Windows 11',
      status: 'Online'
    } : null
  }));
  data.devices.push({ name: 'Otro segmento', ip: '192.168.20.1', status: 'online' });
  data.devices.push({ name: 'Reserva desconectada', ip: '192.168.20.2', status: 'offline', is_reserved: true });
  data.devices.push({ name: 'Histórico sin reserva', ip: '192.168.20.3', status: 'offline' });
  data.devices.push({ name: 'Activo con IP pendiente', ip: '—', status: 'online', ip_source: 'unconfirmed', interface: data.segments[0].interface });
  let role = 'super-admin';
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/session' ? { user: { id: 'segments-test', name: 'Prueba', username: 'prueba', role }, capabilities: ['dashboard.read', 'inventory.read'], roles: [] }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
        : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173';
  await page.goto(base);
  await page.locator('.segment-card').first().waitFor();
  assert.equal(await page.locator('.account-button small').innerText(), 'Admin');

  // Elegir principales
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.getByRole('button', { name: 'Quitar Tonatiuh', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar selección' }).click();
  assert.equal(await page.locator('.segment-card').count(), 2);
  await page.reload();
  await page.locator('.segment-card').first().waitFor();
  assert.equal(await page.locator('.segment-card').count(), 2);

  // Al presionar sobre 'Ver dispositivos', NO redirecciona a Inventario
  // Se abre un panel/modal en la parte de abajo con los dispositivos de esa red
  // y la card seleccionada obtiene el borde distintivo (.segment-card-selected)
  const firstCard = page.locator('.segment-card').first();
  await firstCard.getByRole('button', { name: 'Ver dispositivos', exact: true }).click();

  // Verificar que la URL no cambió a /#dispositivos
  assert.match(page.url(), /(#resumen|\/$)/);

  // La card presionada debe tener la clase de borde seleccionado
  assert.equal(await firstCard.evaluate(el => el.classList.contains('segment-card-selected')), true);

  // El modal/panel inferior de dispositivos debe estar abierto
  const devicesPanel = page.locator('.segment-devices-panel');
  await devicesPanel.waitFor();
  assert.equal(await devicesPanel.isVisible(), true);

  // Debe listar los dispositivos que pertenecen a esa red en la nueva lista (por defecto 25)
  await devicesPanel.locator('.segment-devices-table tbody tr').first().waitFor();

  // Verificar encabezado Ubicación (sin interfaz)
  assert.equal(await devicesPanel.locator('th').filter({ hasText: 'Ubicación' }).count(), 1);
  assert.equal(await devicesPanel.locator('th').filter({ hasText: 'Ubicación / Interfaz' }).count(), 0);
  // Verificar clasificación de tipo por OS (Windows -> Computadora, Android -> Teléfono)
  assert.equal(await devicesPanel.locator('tbody tr').nth(0).locator('td').nth(3).innerText(), 'Computadora');
  assert.equal(await devicesPanel.locator('tbody tr').nth(1).locator('td').nth(3).innerText(), 'Teléfono');
  assert.equal(await devicesPanel.locator('.segment-devices-table tbody tr').count(), 25);
  assert.equal(await devicesPanel.getByRole('cell', { name: 'Otro segmento', exact: true }).count(), 0);
  assert.match(await devicesPanel.locator('.table-footer').innerText(), /Mostrando 1–25 de 126 dispositivos/);

  // Probar paginación
  await devicesPanel.getByRole('button', { name: 'Página siguiente' }).click();
  assert.match(await devicesPanel.locator('.table-footer').innerText(), /Mostrando 26–50 de 126 dispositivos/);

  // Probar selector de cantidad: 50, 100, all
  await devicesPanel.getByLabel('Dispositivos por página').selectOption('50');
  assert.equal(await devicesPanel.locator('.segment-devices-table tbody tr').count(), 50);

  await devicesPanel.getByLabel('Dispositivos por página').selectOption('100');
  assert.equal(await devicesPanel.locator('.segment-devices-table tbody tr').count(), 100);

  await devicesPanel.getByLabel('Dispositivos por página').selectOption('all');
  assert.equal(await devicesPanel.locator('.segment-devices-table tbody tr').count(), 126);
  assert.match(await devicesPanel.locator('.table-footer').innerText(), /Mostrando todos los 126 dispositivos/);

  // Búsqueda en la lista inferior
  await devicesPanel.getByPlaceholder('Buscar por equipo, IP, MAC o fabricante…').fill('Local 10');
  const filteredCount = await devicesPanel.locator('.segment-devices-table tbody tr').count();
  assert.ok(filteredCount > 0 && filteredCount < 126);

  // Al presionar Ocultar dispositivos se cierra y se retira el borde
  await firstCard.getByRole('button', { name: 'Ocultar dispositivos', exact: true }).click();
  assert.equal(await devicesPanel.count(), 0);
  assert.equal(await firstCard.evaluate(el => el.classList.contains('segment-card-selected')), false);

  // Al abrir de nuevo y dar clic en el botón Cerrar del panel inferior
  await firstCard.getByRole('button', { name: 'Ver dispositivos', exact: true }).click();
  await devicesPanel.waitFor();
  assert.equal(await firstCard.evaluate(el => el.classList.contains('segment-card-selected')), true);
  await devicesPanel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await devicesPanel.count(), 0);
  assert.equal(await firstCard.evaluate(el => el.classList.contains('segment-card-selected')), false);

  // Al presionar en cualquier parte de la fila de la lista, abre el detalle del dispositivo
  await firstCard.getByRole('button', { name: 'Ver dispositivos', exact: true }).click();
  await devicesPanel.waitFor();
  await devicesPanel.locator('.segment-device-row').first().click();
  await page.locator('dialog[open]').waitFor();
  assert.equal(await page.locator('dialog[open] h2').innerText(), 'Local 0');
  assert.equal(await page.locator('.omni-detail-box').count(), 1);
  await page.keyboard.press('Escape');

  // Accesibilidad y captura de pantalla
  await page.screenshot({ path: 'artifacts/dashboard-segment-devices-bottom.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id), []);
  await page.screenshot({ path: 'artifacts/dashboard-segment-devices-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(errors, []);
  console.log('PASS: in-place bottom segment devices modal, card selection border, search filter, toggle & close');
} finally { await browser.close(); }
