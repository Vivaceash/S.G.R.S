import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';

const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? {executablePath: process.env.SGRS_BROWSER} : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
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
  // Dispositivo adicional para user.0 para verificar dropdown de múltiples dispositivos
  data.devices.push({
    name: 'Celular de user.0',
    ip: '192.168.10.200',
    mac: '001A2B3C9999',
    status: 'online',
    os: 'Android 14',
    interface: data.segments[0].interface,
    omnivista: {
      matched: true,
      mac: '001A2B3C9999',
      device_name: 'celular-user-0',
      account: 'user.0',
      category: 'Mobile',
      os: 'Android 14',
      status: 'Online',
    },
  });
  data.devices.push({ name: 'Otro segmento', ip: '192.168.20.1', status: 'online' });
  data.devices.push({ name: 'Reserva desconectada', ip: '192.168.20.2', status: 'offline', is_reserved: true });
  data.devices.push({ name: 'Histórico sin reserva', ip: '192.168.20.3', status: 'offline' });
  data.devices.push({ name: 'Activo con IP pendiente', ip: '—', status: 'online', ip_source: 'unconfirmed', interface: data.segments[0].interface });
  let role = 'super-admin';
  let principalSegments = null;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/dashboard/preferences') {
      if (route.request().method() === 'POST') principalSegments = route.request().postDataJSON().principal_segments;
      return route.fulfill({ json: { principal_segments: principalSegments } });
    }
    const payload = path === '/api/auth/session' ? { user: { id: 'segments-test', name: 'Prueba', username: 'prueba', role }, capabilities: ['dashboard.read', 'inventory.read'], roles: [] }
      : path === '/api/networks' ? { networks: data.segments, sources: [], partial: false }
      : path === '/api/forti/network/dhcp-pools' ? { success: true, data: { pools: data.segments } }
        : data[path.slice(5)] ?? {};
    return route.fulfill({ json: payload });
  });
  const base = process.env.SGRS_TEST_URL || 'http://127.0.0.1:5173';
  await page.goto(`${base}/#resumen`);
  await page.locator('.segment-card').first().waitFor();
  assert.ok(await page.locator('.account-button').isVisible());

  // Elegir principales
  await page.getByRole('button', { name: 'Elegir principales', exact: true }).click();
  await page.getByRole('button', { name: 'Quitar Tonatiuh', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar selección' }).click();
  assert.equal(await page.locator('.segment-card').count(), 2);
  assert.deepEqual(principalSegments, [
    JSON.stringify([data.segments[0].id, data.segments[0].interface]),
    JSON.stringify([data.segments[2].id, data.segments[2].interface]),
  ]);
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
  assert.equal(await devicesPanel.locator('.pagination').count(), 0);
  const list = devicesPanel.locator('.segment-devices-list');
  for (let i=0; i<6; i++) {
    await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await page.waitForTimeout(150);
  }
  assert.equal(await devicesPanel.locator('.segment-devices-table tbody tr').count(), 127);

  // Búsqueda en la lista inferior
  await devicesPanel.getByPlaceholder('Buscar por equipo, IP, MAC o fabricante…').fill('Local 10');
  await page.waitForTimeout(300);
  const filteredCount = await devicesPanel.locator('.segment-devices-table tbody tr').count();
  assert.ok(filteredCount > 0 && filteredCount < 127);

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
  assert.equal(await page.locator('dialog[open] h2').innerText(), 'ov-device-0');
  assert.equal(await page.locator('.omni-detail-box').count(), 1);
  assert.equal(await page.locator('.forti-detail-box').count(), 1);
  assert.equal(await page.locator('#device-detail-dropdown').isVisible(), true);
  assert.equal(await page.locator('#device-detail-dropdown option').count(), 2);
  await page.locator('#device-detail-dropdown').selectOption('1');
  assert.ok((await page.locator('.omni-detail-box').textContent()).includes('celular-user-0'));
  await page.keyboard.press('Escape');

  // Accesibilidad y captura de pantalla
  await page.screenshot({ path: '/tmp/sgrs-audit-segment-devices-bottom.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id), []);
  await page.screenshot({ path: '/tmp/sgrs-audit-segment-devices-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(errors, []);
  console.log('PASS: in-place bottom segment devices modal, card selection border, search filter, toggle & close');

  // Meztli must use the same confirmed connections in its card and details.
  const meztli = data.segments.find(segment => segment.name === 'Meztli');
  meztli.active_leases = 6;
  data.segments = [meztli];
  const prefix = meztli.default_gateway.split('.').slice(0, 3).join('.');
  data.devices = [
    ...Array.from({ length: 6 }, (_, i) => ({ name: `Confirmado ${i}`, ip: `${prefix}.${i + 10}`, status: 'online', ip_source: 'dhcp+arp' })),
    ...Array.from({ length: 20 }, (_, i) => ({ name: `Sin confirmar ${i}`, ip: '—', status: 'online', ip_source: 'unconfirmed', interface: meztli.interface })),
    { name: 'Detección histórica', ip: `${prefix}.80`, status: 'online', ip_source: 'device-detection' },
    { name: 'Reserva fuera de línea', ip: `${prefix}.81`, status: 'offline', ip_source: 'reservation', is_reserved: true },
  ];
  meztli.dhcp_clients = data.devices.slice(0, 6).map(device => ({ ip: device.ip, hostname: device.name, interface: meztli.interface }));
  principalSegments = null;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const meztliCard = page.locator('.segment-card').filter({ has: page.getByRole('heading', { name: 'Meztli', exact: true }) });
  await meztliCard.waitFor();
  assert.equal(await meztliCard.locator('.segment-secondary dd strong').innerText(), '6');
  await meztliCard.getByRole('button', { name: 'Ver dispositivos', exact: true }).click();
  await page.locator('.segment-devices-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.segment-devices-table tbody tr').count(), 6);
  assert.equal(await page.locator('.segment-devices-panel').getByText('Pendiente de confirmar', { exact: true }).count(), 0);
  assert.equal(await page.locator('.segment-devices-panel').getByText('Detección histórica', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: Meztli card and device list show only six confirmed online fixture connections');
} finally { await browser.close(); }
