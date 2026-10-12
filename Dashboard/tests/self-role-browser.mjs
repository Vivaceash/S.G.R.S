import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { createDemo } from '../src/demo.mjs';
import { ROLE_PAGE_DEFAULTS, BASE_ROLE_CATALOG } from '../src/domain.mjs';

// All API responses are isolated fixtures; no operational account is changed.
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? { executablePath: process.env.SGRS_BROWSER } : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const user = { id: 'test-self', username: 'verify.local', name: 'Responsable de prueba', role: 'super-admin', active: true, version: 1, allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'] };
  const identity = { user, roles: BASE_ROLE_CATALOG, allowed_pages: user.allowed_pages, csrf: 'test-only', capabilities: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'users.read', 'users.create', 'users.edit', 'users.delete', 'integrations.manage', 'traffic.read', 'inventory.write'] };
  const fixture = createDemo();
  let confirmed = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: identity });
    if (path === '/api/admin/users') return route.fulfill({ json: { users: [user, { ...user, id: 'backup', username: 'backup.local', name: 'Respaldo de prueba' }] } });
    if (path === '/api/admin/users/save') {
      const body = route.request().postDataJSON();
      assert.equal(body.id, 'backup');
      assert.equal(body.role, 'admin');
      assert.equal(body.confirmed, true);
      confirmed = true;
      return route.fulfill({ json: { user: { ...user, ...body, version: 2 } } });
    }
    if (path === '/api/admin/catalog') return route.fulfill({ json: { modules: [] } });
    return route.fulfill({ json: path.endsWith('dhcp-pools') ? { data: { pools: fixture.segments } } : fixture[path.split('/').pop()] ?? {} });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://localhost:3000'}/#usuarios`);
  const selfRow = page.getByRole('row').filter({ hasText: user.name });
  assert.equal(await selfRow.getByRole('button', { name: 'Administrar', exact: true }).count(), 0);
  await page.getByRole('row').filter({ hasText: 'Respaldo de prueba' }).getByRole('button', { name: 'Administrar', exact: true }).click();
  const role = page.getByLabel(/Rol asignado/);
  assert.equal(await role.isEnabled(), true);
  await role.selectOption('admin');
  await page.getByLabel(/Confirmo actualizar esta cuenta con el rol Administrador/).check();
  await page.getByRole('button', { name: 'Guardar usuario y permisos', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Vuelve a iniciar sesión', exact: true }).count(), 0);
  assert.equal(confirmed, true);
  assert.deepEqual(errors, []);
  console.log('PASS: la propia cuenta queda en solo consulta y un super-admin puede cambiar una cuenta subordinada; sin cambios a cuentas reales.');
} finally {
  await browser.close();
}
