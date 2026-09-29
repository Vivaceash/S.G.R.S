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
  await page.goto(`${base}/#soporte`);
  await page.waitForTimeout(1000);

  // 1. Heading verification
  const heading = await page.textContent('h1');
  console.log('Heading:', heading);
  assert.equal(heading, 'Dashboard de Soporte');

  // 2. Columna 1: Panel resumen de saturación
  const satPanel = await page.locator('.support-saturation-panel').isVisible();
  assert.equal(satPanel, true, 'Debe renderizarse el panel resumen de saturación en Columna 1');

  const satCountsText = await page.locator('.support-saturation-counts').textContent();
  console.log('Saturation counts text:', satCountsText);
  assert.ok(satCountsText.includes('Saturada'), 'Debe incluir badge de saturadas');
  assert.ok(satCountsText.includes('Uso medio'), 'Debe incluir badge de uso medio');
  assert.ok(satCountsText.includes('Disponible'), 'Debe incluir badge de disponible');

  const satBalanceText = await page.locator('.support-saturation-balance').textContent();
  console.log('Saturation balance text:', satBalanceText);
  assert.ok(satBalanceText.includes('Total IPs'), 'Debe incluir Total IPs');
  assert.ok(satBalanceText.includes('IPs Ocupadas'), 'Debe incluir IPs Ocupadas');
  assert.ok(satBalanceText.includes('IPs Libres'), 'Debe incluir IPs Libres');

  // 3. Tarjetas de red con desglose
  const breakdownCount = await page.locator('.support-network-breakdown').count();
  assert.ok(breakdownCount > 0, 'Las tarjetas de red deben incluir desglose explícito');

  const firstBreakdownText = await page.locator('.support-network-breakdown').first().textContent();
  console.log('First network breakdown text:', firstBreakdownText);
  assert.ok(firstBreakdownText.includes('IPs Ocupadas'), 'Desglose debe mostrar IPs Ocupadas');
  assert.ok(firstBreakdownText.includes('IPs Libres'), 'Desglose debe mostrar IPs Libres');
  assert.ok(firstBreakdownText.includes('Capacidad'), 'Desglose debe mostrar Capacidad');

  // 4. Botón y Diálogo de exportación CSV con checkboxes
  const exportBtn = page.locator('.support-export-action');
  assert.equal(await exportBtn.isVisible(), true, 'Botón de exportar CSV debe ser visible');
  await exportBtn.click();
  await page.waitForTimeout(400);

  const exportDialog = page.locator('dialog[open]');
  assert.equal(await exportDialog.isVisible(), true, 'Diálogo de exportación CSV debe abrirse');

  const dialogTitle = await exportDialog.locator('h2').textContent();
  assert.ok(dialogTitle.includes('Exportar listado de dispositivos (CSV)'), 'Título de diálogo de exportación CSV correcto');

  const checkboxes = exportDialog.locator('input[type="checkbox"]');
  assert.equal(await checkboxes.count(), 2, 'Deben haber 2 checkboxes (computadoras e impresoras)');
  assert.equal(await checkboxes.nth(0).isChecked(), true, 'Computadoras marcado por defecto');
  assert.equal(await checkboxes.nth(1).isChecked(), true, 'Impresoras marcado por defecto');

  // Probar selección rápida
  const soloComputadorasBtn = exportDialog.locator('button:has-text("Solo computadoras")');
  await soloComputadorasBtn.click();
  assert.equal(await checkboxes.nth(0).isChecked(), true, 'Computadoras sigue activo');
  assert.equal(await checkboxes.nth(1).isChecked(), false, 'Impresoras desmarcado');

  const soloImpresorasBtn = exportDialog.locator('button:has-text("Solo impresoras")');
  await soloImpresorasBtn.click();
  assert.equal(await checkboxes.nth(0).isChecked(), false, 'Computadoras desmarcado');
  assert.equal(await checkboxes.nth(1).isChecked(), true, 'Impresoras activo');

  const ambosBtn = exportDialog.locator('button:has-text("Ambos")');
  await ambosBtn.click();
  assert.equal(await checkboxes.nth(0).isChecked(), true, 'Ambos activa computadoras');
  assert.equal(await checkboxes.nth(1).isChecked(), true, 'Ambos activa impresoras');

  // Cerrar diálogo de exportación
  const cancelBtn = exportDialog.locator('button:has-text("Cancelar")');
  await cancelBtn.click();
  await page.waitForTimeout(300);
  assert.equal(await exportDialog.isVisible(), false, 'Diálogo de exportación debe cerrarse con Cancelar');

  // 5. Ficha Técnica en Modal (DeviceDetail)
  const firstDeviceCard = page.locator('.support-device-card').first();
  await firstDeviceCard.click();
  await page.waitForTimeout(500);

  const detailModal = page.locator('dialog[open]');
  assert.equal(await detailModal.isVisible(), true, 'Modal de detalle de dispositivo debe abrirse');

  const fortiBox = detailModal.locator('.forti-detail-box');
  assert.equal(await fortiBox.isVisible(), true, 'Caja de cotejo FortiGate debe ser visible');

  const fortiBoxText = await fortiBox.textContent();
  console.log('FortiGate detail box text:', fortiBoxText);
  assert.ok(fortiBoxText.includes('Usuario identificado'), 'Debe contener Usuario identificado');
  assert.ok(fortiBoxText.includes('Interfaz'), 'Debe contener Interfaz');
  assert.ok(fortiBoxText.includes('FortiGate de procedencia'), 'Debe contener FortiGate de procedencia');
  assert.ok(fortiBoxText.includes('Hostname / Detected Device'), 'Debe contener Hostname / Detected Device');
  assert.ok(fortiBoxText.includes('Número de serie'), 'Debe contener Número de serie');

  assert.equal(errors.length, 0, `Browser errors detected: ${errors.join(', ')}`);
  console.log('ALL SUPPORT DASHBOARD BROWSER TESTS PASSED!');
} finally {
  await browser.close();
}
