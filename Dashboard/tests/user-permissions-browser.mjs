import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.mjs';
import { BASE_ROLE_CATALOG, ROLE_PAGE_DEFAULTS, defaultSubmodules } from '../src/domain.mjs';
import { ROLE_CAPABILITIES } from '../src/user-permissions.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1627, height: 882 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const data = createDemo();
  let actor = { id: 'owner', name: 'Responsable', username: 'owner', role: 'super-admin', version: 1,
    allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'], allowed_submodules: defaultSubmodules(ROLE_PAGE_DEFAULTS['super-admin']),
    capabilities: ROLE_CAPABILITIES['super-admin'] };
  let submitted;
  let users = [actor];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/auth/session') body = { user: actor, csrf: 'test', capabilities: actor.capabilities,
      allowed_pages: actor.allowed_pages, allowed_submodules: actor.allowed_submodules, roles: BASE_ROLE_CATALOG };
    else if (path === '/api/admin/users') body = { users };
    else if (path === '/api/admin/users/save') {
      submitted = route.request().postDataJSON();
      const saved = { ...submitted, id: 'created-user', version: 1 };
      users.push(saved); body = { user: saved };
    } else if (path === '/api/admin/catalog') body = { modules: [] };
    else if (path === '/api/networks') body = { networks: data.segments, sources: [], partial: false };
    else body = data[path.slice(5)] ?? {};
    await route.fulfill({ json: body });
  });
  await page.goto(`${process.env.SGRS_TEST_URL || 'http://127.0.0.1:3000'}/#usuarios`);
  await page.getByRole('button', { name: 'Crear usuario', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const permissions = dialog.getByRole('region', { name: 'Permisos por módulo', exact: true });
  await expect(permissions).toBeVisible();
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1627, height: 882 }]) {
    await page.setViewportSize(viewport);
    await permissions.scrollIntoViewIfNeeded();
    const layout = await permissions.evaluate(el => {
      const rows = [...el.querySelectorAll('.modular-page-group')].map(row => row.getBoundingClientRect());
      return { overflow: el.scrollWidth > el.clientWidth + 1,
        aligned: rows.every(row => Math.abs(row.left - rows[0].left) < 1 && Math.abs(row.width - rows[0].width) < 1) };
    });
    assert.equal(layout.overflow, false, 'permissions must fit viewport');
    assert.equal(layout.aligned, true, 'modules must share a single aligned column');
  }
  await page.screenshot({ path: '/tmp/sgrs-permissions-layout.png' });

  await expect(dialog.getByRole('heading', { name: 'Permisos funcionales', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Nombre completo', { exact: false }).fill('Creador delegado');
  await dialog.getByLabel('Usuario de acceso', { exact: false }).fill('delegated.creator');
  await dialog.getByRole('button', { name: 'Deseleccionar', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Access Points', exact: true }).check();
  const apTabs = dialog.getByRole('region', { name: 'Permisos de Access Points', exact: true });
  await expect(apTabs.getByRole('checkbox', { name: 'Mapa físico', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Access Points', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Crear usuarios', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: 'Usuarios y privilegios', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Editar usuarios', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Eliminar usuarios', exact: true })).not.toBeChecked();
  const position = await dialog.evaluate(el => ({
    permissionsBottom: el.querySelector('.unified-permissions').getBoundingClientRect().bottom,
    passwordTop: [...el.querySelectorAll('.notice')].find(node => node.textContent.includes('Contraseña inicial asignada')).getBoundingClientRect().top,
  }));
  assert.ok(position.passwordTop >= position.permissionsBottom);
  await dialog.getByRole('checkbox', { name: /Confirmo crear esta cuenta/ }).check();
  await dialog.getByRole('button', { name: 'Crear usuario y asignar rol', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  assert.deepEqual(submitted.allowed_pages, ['usuarios']);
  assert.deepEqual(submitted.capabilities.sort(), ['users.create', 'users.read']);
  actor = users.find(user => user.id === 'created-user');
  await page.reload();
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Usuarios y privilegios', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear usuario', exact: true })).toBeEnabled();
  assert.equal(await page.getByRole('button', { name: 'Administrar', exact: true }).count(), 0, 'leer y crear no concede edición');
  await page.getByRole('button', { name: 'Crear usuario', exact: true }).click();
  const options = await page.getByLabel('Rol asignado', { exact: false }).locator('option').evaluateAll(nodes => nodes.map(node => node.value));
  assert.deepEqual(options.sort(), ['soporte', 'viewer']);
  assert.deepEqual(errors, []);
  console.log('PASS: unified permissions, password notice order, action/page prerequisites, delegated navigation, create action and hierarchy.');
} finally { await browser.close(); }
