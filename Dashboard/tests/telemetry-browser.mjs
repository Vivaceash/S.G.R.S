import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createDemo } from '../src/demo.mjs';

const modules = JSON.parse(execFileSync(process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python', ['-c', 'import json; from dashboard_catalog import CATALOG; print(json.dumps(CATALOG))'], { cwd: '..' , encoding: 'utf8' }));
const base = process.env.SGRS_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? { executablePath: process.env.SGRS_BROWSER } : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const demo = createDemo();
  let role = 'super-admin', failure = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === '/api/auth/session') data = { user: { id: 'test', role, name: 'Prueba', username: 'test', version: 1 }, csrf: 'test', capabilities: role === 'admin' ? ['dashboard.read'] : ['dashboard.read', 'traffic.read', 'users.read', 'users.create', 'users.edit', 'users.delete'], roles: [] };
    else if (path === '/api/admin/catalog') data = { modules };
    else if (path === '/api/health') data = { forti: true, omni: true };
    else if (['/api/idfs', '/api/ips', '/api/devices', '/api/reports'].includes(path)) data = demo[path.slice(5)];
    else {
      const resource = modules.flatMap(module => module.resources).find(item => item.path.split('?')[0] === path);
      if (failure) return route.fulfill({ status: 502, json: { error: 'Proveedor no disponible' } });
      const row = { name: 'Registro de prueba', password: 'NEVER-SHOW-THIS', ...Object.fromEntries((resource?.columns || []).map(column => [column.key, 'Dato verificado'])) };
      data = { success: true, data: resource?.collection ? { [resource.collection]: [row] } : resource?.columns.length ? [row] : { state: 'Disponible', clientSecret: 'NEVER-SHOW-THIS' } };
    }
    return route.fulfill({ json: data });
  });
  let count = 0;
  for (const module of modules) {
    await page.goto(`${base}/#consulta/${module.id}`);
    for (const resource of module.resources) {
      await page.getByLabel(module.title, { exact: true }).selectOption(resource.id);
      await page.getByRole('heading', { name: resource.title, exact: true }).waitFor();
      await page.getByRole('button', { name: 'Ver campos', exact: true }).first().click();
      assert.equal(await page.getByText('NEVER-SHOW-THIS', { exact: true }).count(), 0);
      await page.keyboard.press('Escape');
      count++;
    }
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    if (axe.violations.length) console.log(JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))));
    assert.deepEqual(axe.violations.map(value => value.id), [], module.title);
  }
  await page.getByRole('searchbox', { name: 'Buscar en registros recibidos' }).fill('zz-no-results');
  await page.getByRole('heading', { name: 'No se encontraron resultados' }).waitFor();
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  failure = true;
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await page.getByRole('heading', { name: 'No se pudo cargar la información' }).waitFor();
  failure = false;
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await page.getByRole('button', { name: 'Ver campos', exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Redes e IPAM' }).click();
  await page.getByRole('heading', { name: 'Capacidad DHCP', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  role = 'admin';
  await page.reload();
  await page.getByRole('heading', { name: 'No tienes permiso para esta sección' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Consultas de red' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(`${count} consultas: navegación, detalles, permisos, búsqueda, recuperación, móvil y accesibilidad verificadas.`);
} finally { await browser.close(); }
