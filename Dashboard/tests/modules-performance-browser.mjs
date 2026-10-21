import { chromium } from '@playwright/test';
import { createDemo } from '../src/demo.mjs';
import { AVAILABLE_PAGES, ROLE_PAGE_DEFAULTS, defaultSubmodules } from '../src/domain.mjs';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const catalog = JSON.parse(execFileSync(process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python', ['-c','import json; from dashboard_catalog import CATALOG; print(json.dumps(CATALOG))'], {encoding:'utf8',cwd:new URL('../../',import.meta.url)}));
const data = createDemo();
const baseDevices = data.devices;
data.devices = Array.from({ length: 1200 }, (_, i) => ({ ...baseDevices[i % baseDevices.length], name: `Equipo-${i}`, mac: `aa:bb:${Math.floor(i / 256).toString(16).padStart(2,'0')}:00:00:${(i%256).toString(16).padStart(2,'0')}`, ip: `10.50.${Math.floor(i/250)}.${i%250+1}`, status: 'online', type: i % 4 ? 'Computadora' : 'Impresora', os: i % 4 ? 'Windows 11' : '', uptime_seconds: i * 60 }));
const assets = ['cctv', 'cctv_original', 'ap', 'idf'].flatMap(dataset => Array.from({ length: 300 }, (_, i) => ({ id: `${dataset}-${i}`, dataset, name: `Recurso ${dataset} ${i}`, idf_id: data.idfs[0]?.id, kind: 'equipment', version: 'test:0', model: 'Modelo de prueba', location: 'Planta baja', issues: [], source: {}, decommissioned: false })));
const document = { assets, cabinets: data.idfs.map(r => ({ id: r.id, name: r.name })), observations: [], sources: [], structure: {}, revision: 'test' };
const users = Array.from({ length: 1000 }, (_, i) => ({ id: `u-${i}`, username: `usuario.${i}`, name: `Usuario ${i}`, fullName: `Usuario ${i}`, role: 'admin', active: true, version: 1, status: 'online', description: 'Oficio', dateOfEffective: Date.now() + 86400000, devices: [] }));
const aps = Array.from({ length: 250 }, (_, i) => ({ id: `ap-${i}`, name: `AP ${i}`, mac: `aa:bb:${i}`, serial: `AP-${i}`, model: 'AP de prueba', status: 'online', idf_tag: 'IDF 1', clients: 2 }));
const movements = Array.from({ length: 80 }, (_, i) => ({ id: `movimiento-${i}`, date: new Date().toISOString(), idf_name: 'IDF 3', element: `Tóner ${i}`, identifier: `TON-${i}`, actor: 'Prueba', notes: 'Registro de prueba del navegador', quantity: 1, unit: 'pza' }));
const capabilities = ['dashboard.read','inventory.read','inventory.write','inventory.export','idf.read','idf.visits.write','activity.read','traffic.read','users.read','users.create','users.edit','users.delete','integrations.manage'];
const browser = await chromium.launch({ ...(process.env.SGRS_BROWSER ? {executablePath:process.env.SGRS_BROWSER} : {}) });
const base=process.env.SGRS_TEST_URL || 'http://localhost:3000';
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let apRequests = 0, altasRequests = 0, documentaryRequests = 0, healthFinished = false;
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    let response = {};
    if (path === '/api/auth/session') response = { user: { id:'audit', username:'audit', name:'Prueba', role:'super-admin', version:1 }, capabilities, allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'], allowed_submodules: defaultSubmodules(ROLE_PAGE_DEFAULTS['super-admin']), roles: [] };
    else if (path === '/api/health') { await new Promise(resolve => setTimeout(resolve, 3000)); healthFinished = true; response = { forti:true, omni:true }; }
    else if (path === '/api/admin/catalog') response = { modules:catalog };
    else if (path === '/api/inventory/catalog') { documentaryRequests++; response = document; }
    else if (path === '/api/aps/omnivista') { apRequests++; response = { aps, summary:{total:250,online:250,clients:500} }; }
    else if (path === '/api/aps/map') response = { positions:aps.slice(0,100).map((ap,i)=>({id:`pos-${i}`,ap_id:ap.id,floor_id:['planta-baja','piso-1','piso-2','piso-3'][i%4],x:10+(i%10)*8,y:10+Math.floor(i/10)*8})) };
    else if (path === '/api/admin/users') response = { users };
    else if (path === '/api/admin/connections') response = { connections:['forti','omni','inventarios'].map(id=>({id,url:'http://127.0.0.1:8000/api/v1',auth_mode:'api-key',version:0,has_secret:true})) };
    else if (path === '/api/altas/omnivista') { altasRequests++; response = { success:true, data:{ users, sources:{} } }; }
    else if (path === '/api/support/movements') response = { movements };
    else if (path === '/api/support/inventory') response = { items:Array.from({length:50},(_,i)=>({id:`stock-${i}`,description:`Tóner ${i}`,quantity:10,unit:'pza'})) };
    else if (path === '/api/networks') response = { networks: data.segments, sources: [], partial: false };
    else if (path === '/api/forti/network/dhcp-pools') response = { success:true,data:{pools:data.segments} };
    else if (path === '/api/forti/network/dhcp-leases') response = { success:true,data:data.devices.filter((_,i)=>i%8===0).map(d=>({...d,interface:'SSID-Meztli',is_reserved:false})) };
    else if (path === '/api/audit') response = { events: users.slice(0,300).map((u,i)=>({id:i,created_at:Date.now()/1000,action:'session.login',actor_name:u.name,target_label:u.username})) };
    else if (path in Object.fromEntries(['idfs','devices','ips','reports'].map(k=>[`/api/${k}`,1]))) response = data[path.slice(5)];
    else {
      const resource = catalog.flatMap(m=>m.resources).find(item=>item.path.split('?')[0]===path);
      if(resource) { const rows=users.slice(0,200).map((u,i)=>({...Object.fromEntries(resource.columns.map(c=>[c.key,`${c.key}-${i}`])),_key:i})); response={success:true,data:resource.collection?{[resource.collection]:rows}:resource.columns.length?rows:{state:'Disponible'}}; }
    }
    await r.fulfill({json:response});
  });
  const start = Date.now();
  await page.goto(`${base}/#dispositivos`, {waitUntil:'domcontentloaded'});
  await page.locator('table tbody tr').first().waitFor();
  const firstReady = Date.now()-start;
  assert.equal(healthFinished,false,'Device page must not wait for unrelated slow provider');
  console.log('devices-ready-before-slow-health',firstReady);
  for (const module of AVAILABLE_PAGES) {
    await page.evaluate(route => { location.hash=route; }, module.id === 'bitacora-idf' ? 'idf' : module.id);
    await page.waitForTimeout(450);
    const heading=await page.locator('main h1').first().textContent();
    assert.ok(!/No tienes permiso|no encontrada/i.test(heading),`${module.id}: ${heading}`);
    const main=page.locator('#main-content');
    if(module.id==='bitacora-idf') { const overview=main.getByRole('button',{name:'Ver todos los IDF',exact:true});if(await overview.count()) await overview.click(); }
    const search=main.getByRole('searchbox').first();
    if(await search.count()) { await search.fill('zz-audit-no-match'); await page.waitForTimeout(120); await search.fill(''); }
    const selectors=main.locator('select');
    if(await selectors.count() && module.id!=='conexiones') {
      const select=selectors.first();const options=await select.locator('option').evaluateAll(els=>els.filter(e=>!e.disabled).map(e=>e.value));
      if(options.length>1){const old=await select.inputValue();await select.selectOption(options[1]);await select.selectOption(old);}
    }
    const tabs=main.getByRole('tab');
    const visited=[];
    for(let i=0;i<await tabs.count();i++){const tab=main.getByRole('tab').nth(i);const label=await tab.textContent();await tab.click();if(module.id==='aps' && /Catálogo documental/.test(label)) await main.locator('table tbody tr').first().waitFor();await page.waitForTimeout(100);visited.push(label.trim());}
    if(module.id==='idf') {
      const card=main.locator('.idf-card').first();await card.click();await page.waitForTimeout(150);
      const idfTabs=main.getByRole('tab');for(let i=0;i<await idfTabs.count();i++){const tab=idfTabs.nth(i);visited.push((await tab.textContent()).trim());await tab.click();await page.waitForTimeout(100);}
    }
    if(module.id==='disponibilidad'){
      await main.getByRole('button',{name:/Lista$/}).click();visited.push('Lista');
      await main.getByRole('button',{name:/Matriz$/}).click();visited.push('Matriz');
    }
    if(module.id==='dispositivos') {
      const scroll = main.locator('.table-scroll').first();
      assert.ok(await main.locator('table tbody tr').count() <= 100, 'Device table must keep a bounded DOM window');
      const first = await main.locator('table tbody tr').first().textContent();
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(300);
      assert.notEqual(await main.locator('table tbody tr').first().textContent(), first, 'Scrolling must advance the device window');
      assert.ok(await main.locator('table tbody tr').count() <= 100);
      await main.locator('table tbody tr').first().getByRole('button',{name:'Ver',exact:true}).click();
      assert.ok(await page.locator('dialog[open]').count());await page.keyboard.press('Escape');
    }
    const next=main.getByRole('button',{name:'Página siguiente',exact:true}).first();
    if(await next.count() && await next.isEnabled()){await next.click();await main.getByRole('button',{name:'Página anterior',exact:true}).first().click();}
    const cardFilter=main.locator('button.audit-kpi').nth(1);
    if(await cardFilter.count()){await cardFilter.click();await main.locator('button.audit-kpi').first().click();}
    if(module.id==='soporte'){
      await main.getByRole('tab',{name:'En vivo',exact:true}).click();
      assert.ok(await main.locator('.support-device-card').count()<=50,'Support must not mount 1200 cards');
      const column=main.locator('.support-device-card').first().locator('..'); await column.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    }
    if(module.id==='aps'){
      await main.getByRole('tab',{name:/En vivo/}).click();const before=apRequests;
      await page.waitForTimeout(4200);assert.equal(apRequests,before,'Unrelated global updates must not reload APs');
    }
    results.push({module:module.id,heading,tabs:visited,tableRows:await main.locator('table tbody tr').count()});
    console.log(module.id,'OK',visited.join(' | '));
  }
  await page.evaluate(() => { location.hash = 'altas'; });
  await page.waitForTimeout(500);
  const beforeAltas = altasRequests;
  assert.ok(beforeAltas > 0);
  await page.evaluate(() => { location.hash = 'dispositivos'; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = 'altas'; });
  await page.waitForTimeout(500);
  assert.equal(altasRequests, beforeAltas, 'Returning to altas must reuse session data');
  await page.evaluate(() => window.dispatchEvent(new Event('sgrs:refresh-current-module')));
  await page.waitForTimeout(500);
  assert.equal(altasRequests, beforeAltas + 1, 'Explicit refresh must reload altas');
  assert.deepEqual(errors,[]);
  if(process.env.SGRS_PERF_REPORT) writeFileSync(process.env.SGRS_PERF_REPORT,JSON.stringify({firstReady,results,apRequests,documentaryRequests,errors},null,2));
  console.log('ALL MODULES PASSED');
} finally { await browser.close(); }
