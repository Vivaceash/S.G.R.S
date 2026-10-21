import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInstitutionalDevice,
  isWifiDevice,
  getInstitutionalWifiDevices,
  SUPPORT_WIDGET_CATALOG,
  DEFAULT_SUPPORT_LAYOUT,
  sanitizeSupportLayout,
} from '../src/support-widgets-domain.mjs';

test('isInstitutionalDevice reconoce hostnames con prefijo 04820300 de Fortinet', () => {
  const dev1 = { hostname: '04820300-56MQ62', name: '04820300-56MQ62' };
  const dev2 = { hostname: '04820300-0D92S5', name: 'PC-ADMIN' };
  const dev3 = { name: '04820300-QCS125' };
  const dev4 = { raw: { host_name: '04820300-J3MQ62' } };
  const dev5 = { serial: '04820300-5WR5D1' };

  assert.equal(isInstitutionalDevice(dev1), true);
  assert.equal(isInstitutionalDevice(dev2), true);
  assert.equal(isInstitutionalDevice(dev3), true);
  assert.equal(isInstitutionalDevice(dev4), true);
  assert.equal(isInstitutionalDevice(dev5), true);

  // No institucionales
  assert.equal(isInstitutionalDevice({ hostname: 'LAPTOP-PERSONAL', name: 'LAPTOP-PERSONAL' }), false);
  assert.equal(isInstitutionalDevice({ hostname: 'HP-LASERJET-400', name: 'HP-LASERJET' }), false);
  assert.equal(isInstitutionalDevice(null), false);
  assert.equal(isInstitutionalDevice({}), false);
});

test('isWifiDevice identifica conexiones inalámbricas por OmniVista AP, SSID o VLAN Meztli', () => {
  const devAp = { omnivista: { ap_name: 'AP-PISO2-DIR', ssid: 'meztli' } };
  const devSsid = { omnivista: { ssid: 'WIFI-ISSSTE' } };
  const devMeztliIface = { interface: 'meztli_wl', vlan: '94' };
  const devWired = { interface: 'LAN_QUETZAL', vlan: '90' };

  const segments = [
    { name: 'Red Meztli WiFi', interface: 'vlan94', vlan: 94, ip_ranges: ['192.168.94.1-192.168.94.254'] },
    { name: 'Red Quetzal LAN', interface: 'vlan90', vlan: 90, ip_ranges: ['192.168.90.1-192.168.90.254'] },
  ];
  const devInMeztli = { ip: '192.168.94.20' };

  assert.equal(isWifiDevice(devAp, segments), true);
  assert.equal(isWifiDevice(devSsid, segments), true);
  assert.equal(isWifiDevice(devMeztliIface, segments), true);
  assert.equal(isWifiDevice(devInMeztli, segments), true);
  assert.equal(isWifiDevice(devWired, segments), false);
  assert.equal(isWifiDevice(null), false);
});

test('getInstitutionalWifiDevices filtra correctamente equipos institucionales con WiFi', () => {
  const devices = [
    {
      hostname: '04820300-56MQ62',
      status: 'online',
      ip: '192.168.94.10',
      mac: 'AA:BB:CC:DD:EE:01',
      omnivista: { device_name: 'DIR-MEDICA-PC1', ap_name: 'AP-P2-01', location: 'Piso 2 Dir Médica', matched: true },
      interface: 'meztli',
    },
    {
      hostname: '04820300-CABLEADO',
      status: 'online',
      ip: '192.168.90.15',
      mac: 'AA:BB:CC:DD:EE:02',
      interface: 'quetzal',
    },
    {
      hostname: 'LAPTOP-INVITADO',
      status: 'online',
      ip: '192.168.94.11',
      mac: 'AA:BB:CC:DD:EE:03',
      interface: 'meztli',
    },
    {
      hostname: '04820300-OFFLINE',
      status: 'offline',
      ip: '192.168.94.12',
      mac: 'AA:BB:CC:DD:EE:04',
      interface: 'meztli',
    },
  ];

  const result = getInstitutionalWifiDevices(devices, [], true);
  assert.equal(result.length, 1);
  assert.equal(result[0].hostname, '04820300-56MQ62');
  assert.equal(result[0].omnivista.device_name, 'DIR-MEDICA-PC1');
  assert.equal(result[0].omnivista.ap_name, 'AP-P2-01');

  // Modo wifiOnly=false retorna todos los institucionales online
  const allInst = getInstitutionalWifiDevices(devices, [], false);
  assert.equal(allInst.length, 2);
});

test('sanitizeSupportLayout mantiene el diseño válido y previene duplicados o corruptos', () => {
  const valid = ['institutional-wifi', 'computers'];
  assert.deepEqual(sanitizeSupportLayout(valid), ['institutional-wifi', 'computers']);

  const duplicates = ['computers', 'networks', 'computers', 'invalid-widget'];
  assert.deepEqual(sanitizeSupportLayout(duplicates), ['computers', 'networks']);

  assert.deepEqual(sanitizeSupportLayout(null), DEFAULT_SUPPORT_LAYOUT);
  assert.deepEqual(sanitizeSupportLayout([]), DEFAULT_SUPPORT_LAYOUT);
  assert.deepEqual(sanitizeSupportLayout(['garbage-id']), DEFAULT_SUPPORT_LAYOUT);
});

test('SUPPORT_WIDGET_CATALOG contiene los identificadores clave de soporte', () => {
  const ids = SUPPORT_WIDGET_CATALOG.map(w => w.id);
  assert.equal(ids.length, 4);
  assert.ok(ids.includes('networks'));
  assert.ok(ids.includes('computers'));
  assert.ok(ids.includes('printers'));
  assert.ok(ids.includes('institutional-wifi'));
});
