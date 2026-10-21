import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const base = process.env.SGRS_TEST_URL || 'http://localhost:3000';
try {
  for (const width of [1627, 425]) {
    const page = await browser.newPage({ viewport: { width, height: 882 } });
    await page.clock.install();
    const now = Date.now();
    const users = [
      { activityAssessment: { status: 'inactive', reason: 'Sin autenticación ni coincidencia en Forti' }, username: 'ana.temporal', fullName: 'Ana', description: 'Oficio', department: 'Urgencias', dateOfEffective: now + 3600000, devices: [{ deviceMac: 'AA:BB:CC:DD:EE:01', deviceOS: 'Android' }, { deviceMac: 'AA:BB:CC:DD:EE:02', deviceOS: 'iOS' }] },
      { username: 'bruno.temporal', fullName: 'Bruno', description: 'Temporal', department: 'Sistemas', dateOfEffective: now + 2 * 86400000, devices: [{ deviceMac: 'AA:BB:CC:DD:EE:03', deviceOS: 'Windows 11' }, { deviceMac: 'AA:BB:CC:DD:EE:04', deviceOS: 'macOS' }] },
      { username: 'carla.vencida', fullName: 'Carla', description: 'Oficio', dateOfEffective: now - 1000, devices: [] },
      { username: 'dora.planta', fullName: 'Dora', description: 'Plantilla', devices: [{ deviceMac: 'AA:BB:CC:DD:EE:05', deviceName: 'Apple' }] },
    ];
    let reads = 0;
    let accountReads = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      assert.equal(route.request().method(), 'GET', 'Widgets never write to APIs');
      const path = new URL(route.request().url()).pathname;
      if (path !== '/api/auth/session') reads++;
      if (path === '/api/altas/omnivista') accountReads++;
      const body = path === '/api/auth/session' ? { user: { id: 'altas-widgets-test', role: 'admin', name: 'Prueba' }, allowed_pages: ['altas'], allowed_submodules: ['altas:all', 'altas:oficios'], capabilities: ['dashboard.read'] }
        : path === '/api/altas/omnivista' ? { success: true, data: { users, sources: { users: { complete: true }, company_properties: { complete: false, unassociated: 4 } } } }
        : path.endsWith('dhcp-pools') ? { data: { pools: [] } } : path.endsWith('dhcp-leases') ? { data: [] }
        : ['/api/devices', '/api/ips'].includes(path) ? [] : {};
      return route.fulfill({ json: body });
    });

    await page.addInitScript(() => localStorage.setItem('sgrs:altas-widgets:v1:altas-widgets-test:admin', JSON.stringify([
      {id:'altas-five-devices',size:3}, {id:'altas-multiple-devices',size:3},
      {id:'altas-android',size:3}, {id:'altas-ios',size:3},
      {id:'altas-active',size:3}, {id:'altas-inactive',size:3}
    ])));
    await page.goto(`${base}/#altas`);
    await expect(page.locator('.altas-accounts-list tbody tr')).toHaveCount(4);
    await expect(page.locator('[data-widget="altas-multiple-devices"]')).toHaveCount(1);
    await expect(page.locator('[data-widget="altas-platforms"]')).toHaveCount(1);
    await expect(page.locator('[data-widget="altas-account-status"]')).toHaveCount(1);
    await page.getByRole('button', {name:'Filtrar Usuarios con 2 o más equipos', exact:true}).click();
    await expect(page.locator('.altas-accounts-list tbody tr')).toHaveCount(2);
    await page.getByRole('button', {name:'Filtrar Android', exact:true}).click();
    await expect(page.locator('.altas-accounts-list tbody tr')).toHaveCount(1);
    await page.getByRole('button', {name:'Filtrar Sin estado informado', exact:true}).click();
    await expect(page.locator('.altas-accounts-list tbody tr')).toHaveCount(4);
    await page.getByRole('button', {name:'Personalizar indicadores', exact:true}).click();
    await expect(page.locator('.widget-catalog > article')).toHaveCount(23);
    const palette = await page.locator('.widget-catalog > article').evaluateAll(nodes => nodes.map(node => {
      const button = node.querySelector('.button-primary');
      return { accent: getComputedStyle(node).getPropertyValue('--widget-accent').trim(),
        button: button ? { color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor } : null };
    }));
    assert.ok(new Set(palette.map(item=>item.accent)).size >= 5, 'catalog needs complementary accent families');
    const luminance = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>rgb.startsWith('color(')?v:v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    for (const {button} of palette) if(button) {
      const values = [luminance(button.color),luminance(button.background)].sort((a,b)=>b-a);
      assert.ok((values[0]+.05)/(values[1]+.05)>=4.5, `button text contrast: ${JSON.stringify(button)}`);
    }
    await page.screenshot({path:`/tmp/sgrs-altas-catalog-${width}.png`});

    await expect(page.getByRole('button', {name:'Agregar Usuarios con 5 o más equipos',exact:true})).toHaveCount(0);
    await page.getByRole('button', {name:'Guardar diseño',exact:true}).click();
    const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('sgrs:altas-widgets:v1:altas-widgets-test:admin')));
    assert.deepEqual(saved.map(w=>w.id), ['altas-multiple-devices','altas-platforms','altas-account-status']);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: redundant widgets consolidated, old layouts migrated, filters and saving verified on desktop/mobile.');
} finally { await browser.close(); }
