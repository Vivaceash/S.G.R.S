import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, makeCsv, paginate, selectRows, inventoryFromIdfs, reportsFromData, roleLabel, AVAILABLE_PAGES, ROLE_PAGE_DEFAULTS, formatDeviceType, BASE_ROLE_CATALOG, getEffectiveRoles, formatUptime, getSaturationStatus, getSaturationLabel } from '../src/domain.mjs';

test('Incidencias sin ID conservan su identidad y la resolución sustituye solo su origen', () => {
  const idfs = [{ id: 'idf-1', name: 'IDF 1', incidents: [
    { record_key: 'original-a', title: 'A', status: 'open' },
    { record_key: 'original-b', title: 'B', status: 'open' },
  ] }];
  const reports = { 'idf-1': { incidents: [{ record_key: 'resolved-a', origin_key: 'original-a', title: 'A', status: 'resolved' }] } };
  const rows = reportsFromData(reports, idfs);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.title === 'A').status, 'resolved');
  assert.equal(rows.find(r => r.title === 'B').status, 'open');
});

test('CSV neutraliza fórmulas incluso después de espacios y conserva comillas', () => {
  for (const text of ['=1+1', '  +SUM(A1)', '\t@formula', '-2+4', '\r=1']) assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('Área "Clínica"'), '"Área ""Clínica"""');
});
test('Filtrar restablece una página fuera de rango y el orden de IPs es numérico', () => {
  const rows = [{ ip: '10.0.0.10', status: 'online' }, { ip: '10.0.0.2', status: 'online' }, { ip: '10.0.0.1', status: 'offline' }];
  const filtered = selectRows(rows, '10.0', { status: 'online' }, 'ip');
  assert.deepEqual(filtered.map(r => r.ip), ['10.0.0.2', '10.0.0.10']);
  assert.equal(paginate(filtered, 72, 10).current, 1);
  assert.equal(paginate([], 3).pages, 1);
});
test('Inventario conserva IDF e índice originales para el contrato legacy', () => {
  const rows = inventoryFromIdfs([{ id: 'idf-2', name: 'IDF-02', devices: [{ desc: 'Switch', serial: 'SERIAL' }] }]);
  assert.equal(rows[0].idfId, 'idf-2'); assert.equal(rows[0].index, 0); assert.equal(rows[0].serial, 'SERIAL');
});
test('Bitácora fusiona formatos históricos sin duplicar incidentes de un mismo IDF', () => {
  const idfs = [{ id: 'idf-1', name: 'IDF-01', incidents: [{ id: 'same', title: 'Anterior' }] }, { id: 'idf-2', name: 'IDF-02' }];
  const reports = { 'idf-1': { incidents: [{ id: 'same', title: 'Actualizado' }] }, 'idf-2': [{ id: 'same', title: 'Otro gabinete' }] };
  const rows = reportsFromData(reports, idfs);
  assert.equal(rows.length, 2); assert.equal(rows.find(r => r.idfId === 'idf-1').title, 'Actualizado');
});

test('roleLabel asigna etiquetas precisas para soporte, admin y super-admin', () => {
  assert.equal(roleLabel('super-admin'), 'Admin');
  assert.equal(roleLabel('admin'), 'admin');
  assert.equal(roleLabel('soporte'), 'Soporte');
  assert.equal(roleLabel('viewer'), 'viewer');
});

test('Catálogo AVAILABLE_PAGES y ROLE_PAGE_DEFAULTS son coherentes con las rutas institucionales', () => {
  assert.ok(AVAILABLE_PAGES.some(p => p.id === 'soporte'));
  assert.deepEqual(ROLE_PAGE_DEFAULTS.soporte, ['soporte']);
  assert.ok(ROLE_PAGE_DEFAULTS.admin.includes('usuarios'));
  assert.ok(!ROLE_PAGE_DEFAULTS.admin.includes('conexiones'));
  assert.ok(ROLE_PAGE_DEFAULTS['super-admin'].includes('soporte'));
  assert.ok(ROLE_PAGE_DEFAULTS['super-admin'].includes('conexiones'));
  for (const [role, pages] of Object.entries(ROLE_PAGE_DEFAULTS)) {
    for (const page of pages) {
      assert.ok(AVAILABLE_PAGES.some(p => p.id === page), `Página ${page} en rol ${role} debe estar en AVAILABLE_PAGES`);
    }
  }
});

test('Filtros de computadoras e impresoras en línea para SupportDashboard', () => {
  const devices = [
    { name: 'PC-ADMIN-01', ip: '10.0.0.5', status: 'online', type: 'Computadora', os: 'Windows 11', vendor: 'Dell' },
    { name: 'LAPTOP-DIR', ip: '10.0.0.6', status: 'online', type: '', os: 'Windows 10', vendor: 'HP' },
    { name: 'IMP-PISO-2', ip: '10.0.0.20', status: 'online', type: 'Impresora', os: '', vendor: 'Kyocera' },
    { name: 'EPSON-L5190', ip: '10.0.0.21', status: 'online', type: 'Unknown', os: '', vendor: 'Epson' },
    { name: 'PC-APAGADA', ip: '10.0.0.99', status: 'offline', type: 'Computadora', os: 'Windows 10', vendor: 'Dell' },
    { name: 'TEL-MOVIL', ip: '10.0.0.30', status: 'online', type: 'Teléfono', os: 'Android', vendor: 'Samsung' },
  ];

  const onlineComputers = devices.filter(d => d.status === 'online' && formatDeviceType(d.type, d.os, d.name, d.vendor) === 'Computadora');
  assert.equal(onlineComputers.length, 2);
  assert.deepEqual(onlineComputers.map(c => c.name), ['PC-ADMIN-01', 'LAPTOP-DIR']);

  const onlinePrinters = devices.filter(d => d.status === 'online' && formatDeviceType(d.type, d.os, d.name, d.vendor) === 'Impresora');
  assert.equal(onlinePrinters.length, 2);
  assert.deepEqual(onlinePrinters.map(p => p.name), ['IMP-PISO-2', 'EPSON-L5190']);
});

test('Matriz de acceso desacoplada: admin accede a usuarios sin can(users.manage), conexiones queda restringido a super-admin', () => {
  const isRouteAllowed = (path, userRole, allowedPages, can = () => false) => {
    const canViewPage = p => allowedPages.includes(p);
    if (path === 'conexiones') {
      return Boolean(canViewPage('conexiones') && (userRole === 'super-admin' || can('integrations.manage')));
    }
    return Boolean(canViewPage(path));
  };

  // Rol admin (sin capability users.manage ni integrations.manage)
  const adminPages = ROLE_PAGE_DEFAULTS.admin;
  assert.equal(isRouteAllowed('usuarios', 'admin', adminPages), true, 'Admin debe poder acceder a #usuarios');
  assert.equal(isRouteAllowed('conexiones', 'admin', adminPages), false, 'Admin no debe poder acceder a #conexiones');

  // Rol super-admin
  const superPages = ROLE_PAGE_DEFAULTS['super-admin'];
  assert.equal(isRouteAllowed('usuarios', 'super-admin', superPages), true, 'Super-admin debe poder acceder a #usuarios');
  assert.equal(isRouteAllowed('conexiones', 'super-admin', superPages), true, 'Super-admin debe poder acceder a #conexiones');

  // Rol soporte
  const soportePages = ROLE_PAGE_DEFAULTS.soporte;
  assert.equal(isRouteAllowed('soporte', 'soporte', soportePages), true, 'Soporte debe poder acceder a #soporte');
  assert.equal(isRouteAllowed('usuarios', 'soporte', soportePages), false, 'Soporte no debe poder acceder a #usuarios');
  assert.equal(isRouteAllowed('conexiones', 'soporte', soportePages), false, 'Soporte no debe poder acceder a #conexiones');
});

test('BASE_ROLE_CATALOG y getEffectiveRoles normalizan roles institucionales y excluyen viewer', () => {
  // 1. Catálogo base
  assert.equal(BASE_ROLE_CATALOG.length, 3);
  assert.deepEqual(BASE_ROLE_CATALOG.map(r => r.id), ['soporte', 'admin', 'super-admin']);

  // 2. Si roleInfo viene vacío o nulo
  const fromEmpty = getEffectiveRoles([]);
  assert.deepEqual(fromEmpty.map(r => r.id), ['soporte', 'admin', 'super-admin']);
  const fromNull = getEffectiveRoles(null);
  assert.deepEqual(fromNull.map(r => r.id), ['soporte', 'admin', 'super-admin']);

  // 3. Si roleInfo contenía 'viewer' y le faltaba 'soporte' (sesión antigua en caché)
  const legacyRoles = [
    { id: 'admin', title: 'admin', description: 'Operador' },
    { id: 'viewer', title: 'Viewer', description: 'Consulta' },
    { id: 'super-admin', title: 'Admin', description: 'Super' },
  ];
  const normalizedLegacy = getEffectiveRoles(legacyRoles);
  assert.ok(!normalizedLegacy.some(r => r.id === 'viewer'), 'viewer nunca debe estar en roles normalizados');
  assert.ok(normalizedLegacy.some(r => r.id === 'soporte'), 'soporte siempre debe estar garantizado');
  assert.deepEqual(normalizedLegacy.map(r => r.id), ['soporte', 'admin', 'super-admin']);

  // 4. Roles seleccionables en UserForm según jerarquía del actor
  const isSuperAdminAllowed = ['soporte', 'admin', 'super-admin'];
  const isAdminAllowed = ['soporte', 'admin'];

  // Para super-admin:
  const superSelectable = normalizedLegacy.filter(r => isSuperAdminAllowed.includes(r.id));
  assert.deepEqual(superSelectable.map(r => r.id), ['soporte', 'admin', 'super-admin']);
  assert.equal(roleLabel(superSelectable[0].id), 'Soporte');

  // Para admin (crear usuario):
  const adminSelectable = normalizedLegacy.filter(r => isAdminAllowed.includes(r.id));
  assert.deepEqual(adminSelectable.map(r => r.id), ['soporte', 'admin']);
  assert.equal(adminSelectable[0].id, 'soporte', 'El primer rol seleccionable debe ser soporte');
  assert.equal(roleLabel(adminSelectable[0].id), 'Soporte');
  assert.ok(!adminSelectable.some(r => r.id === 'super-admin'), 'Admin no puede seleccionar super-admin');
  assert.ok(!adminSelectable.some(r => r.id === 'viewer'), 'Admin no puede seleccionar viewer');
});

test('formatUptime formatea la duración de conexión según las reglas del NOC institucional', () => {
  // Casos nulos / no válidos
  assert.equal(formatUptime(null), '—');
  assert.equal(formatUptime(undefined), '—');
  assert.equal(formatUptime(NaN), '—');

  // Menor a 60s
  assert.equal(formatUptime(0), '< 1m');
  assert.equal(formatUptime(25), '< 1m');
  assert.equal(formatUptime(59), '< 1m');

  // Menos de 1h: Xm
  assert.equal(formatUptime(60), '1m');
  assert.equal(formatUptime(45 * 60), '45m');
  assert.equal(formatUptime(59 * 60 + 50), '59m');

  // Menos de 24h: Xh Ym
  assert.equal(formatUptime(3600), '1h 0m');
  assert.equal(formatUptime(5 * 3600 + 23 * 60), '5h 23m');
  assert.equal(formatUptime(23 * 3600 + 59 * 60), '23h 59m');

  // 24h o más: Xd Yh
  assert.equal(formatUptime(86400), '1d 0h');
  assert.equal(formatUptime(3 * 86400 + 14 * 3600), '3d 14h');
  assert.equal(formatUptime(3 * 86400 + 14 * 3600 + 25 * 60), '3d 14h');
  assert.equal(formatUptime(7 * 86400 + 2 * 3600), '7d 2h');
});

test('Ordenamiento por mayor tiempo conectado (Top Uptime) en SupportDashboard', () => {
  const computers = [
    { name: 'PC-RECIENTE', ip: '10.0.0.1', uptime_seconds: 120 }, // 2m
    { name: 'PC-INTERMEDIA', ip: '10.0.0.2', uptime_seconds: 19380 }, // 5h 23m
    { name: 'PC-ANTIGUA', ip: '10.0.0.3', uptime_seconds: 310500 }, // 3d 14h
    { name: 'PC-SIN-UPTIME', ip: '10.0.0.4', uptime_seconds: null },
  ];

  // Orden estándar (conserva orden original)
  const standard = [...computers];
  assert.deepEqual(standard.map(c => c.name), ['PC-RECIENTE', 'PC-INTERMEDIA', 'PC-ANTIGUA', 'PC-SIN-UPTIME']);

  // Orden Top Uptime (descendente por uptime_seconds)
  const topUptime = [...computers].sort((a, b) => (Number(b.uptime_seconds) || 0) - (Number(a.uptime_seconds) || 0));
  assert.deepEqual(topUptime.map(c => c.name), ['PC-ANTIGUA', 'PC-INTERMEDIA', 'PC-RECIENTE', 'PC-SIN-UPTIME']);
  assert.equal(formatUptime(topUptime[0].uptime_seconds), '3d 14h');
  assert.equal(formatUptime(topUptime[1].uptime_seconds), '5h 23m');
  assert.equal(formatUptime(topUptime[2].uptime_seconds), '2m');
  assert.equal(formatUptime(topUptime[3].uptime_seconds), '—');
});

test('getSaturationStatus y getSaturationLabel clasifican umbrales de saturación', () => {
  // Crítico (>= 80%)
  assert.equal(getSaturationStatus(80), 'critical');
  assert.equal(getSaturationStatus(95.5), 'critical');
  assert.equal(getSaturationStatus(100), 'critical');
  assert.equal(getSaturationLabel('critical'), 'Saturada');

  // Uso medio (50% a 79%)
  assert.equal(getSaturationStatus(50), 'warning');
  assert.equal(getSaturationStatus(65), 'warning');
  assert.equal(getSaturationStatus(79.9), 'warning');
  assert.equal(getSaturationLabel('warning'), 'Uso medio');

  // Disponible (< 50%)
  assert.equal(getSaturationStatus(0), 'normal');
  assert.equal(getSaturationStatus(25), 'normal');
  assert.equal(getSaturationStatus(49.9), 'normal');
  assert.equal(getSaturationLabel('normal'), 'Disponible');

  // Desde objeto de segmento con saturation_status o utilization_percent
  assert.equal(getSaturationStatus({ saturation_status: 'critical' }), 'critical');
  assert.equal(getSaturationStatus({ utilization_percent: 85 }), 'critical');
  assert.equal(getSaturationStatus({ utilization_percent: 60 }), 'warning');
  assert.equal(getSaturationStatus({ utilization_percent: 30 }), 'normal');
});

test('Balance de direccionamiento de redes calcula Total IPs, Ocupadas y Libres', () => {
  const segments = [
    { capacity: 254, active_leases: 218, available_ips: 36, utilization_percent: 86 }, // critical
    { capacity: 254, active_leases: 142, available_ips: 112, utilization_percent: 56 }, // warning
    { capacity: 254, active_leases: 89, available_ips: 165, utilization_percent: 35 }, // normal
  ];

  const summary = segments.reduce((acc, s) => {
    const status = getSaturationStatus(s);
    if (status === 'critical') acc.critical++;
    else if (status === 'warning') acc.warning++;
    else acc.normal++;

    const cap = Number(s.capacity) || 0;
    const occ = Number(s.active_leases) || 0;
    const free = s.available_ips != null ? Number(s.available_ips) : Math.max(0, cap - occ);

    acc.totalIps += cap;
    acc.occupiedIps += occ;
    acc.availableIps += free;
    return acc;
  }, { critical: 0, warning: 0, normal: 0, totalIps: 0, occupiedIps: 0, availableIps: 0 });

  assert.equal(summary.critical, 1);
  assert.equal(summary.warning, 1);
  assert.equal(summary.normal, 1);
  assert.equal(summary.totalIps, 762);
  assert.equal(summary.occupiedIps, 449);
  assert.equal(summary.availableIps, 313);
  assert.equal(summary.totalIps, summary.occupiedIps + summary.availableIps);
});

test('makeCsv genera listado de soporte con las 13 columnas cotejadas de FortiGate', () => {
  const sampleDevice = {
    type: 'Computadora',
    os: 'Windows 11',
    vendor: 'Dell',
    ip: '192.168.10.101',
    mac: '00:1A:2B:3C:4D:01',
    serial: '8HG7Y23',
    hostname: 'PC-MED-PISO3',
    detected_device: 'Dell Latitude 5420',
    user: 'ricardo.martinezal',
    interface: 'DATA',
    status: 'online',
    uptime_seconds: 19380,
    location: 'IDF-01 -> 1/1/20',
    fortigate: 'FGT-NOC-TORRE-A',
  };

  const columns = [
    { key: 'device_type', label: 'Tipo de Dispositivo', value: d => formatDeviceType(d.type, d.os, d.hostname, d.vendor) },
    { key: 'ip', label: 'Dirección IP', value: d => d.ip || '—' },
    { key: 'mac', label: 'Dirección MAC', value: d => d.mac || '—' },
    { key: 'serial', label: 'Número de Serie / Service Tag', value: d => d.serial || '—' },
    { key: 'hostname', label: 'Nombre de Equipo / Hostname', value: d => d.hostname || d.detected_device || '—' },
    { key: 'user', label: 'Usuario Detectado', value: d => d.user || '—' },
    { key: 'os', label: 'Sistema Operativo', value: d => d.os || '—' },
    { key: 'interface', label: 'Interfaz', value: d => d.interface || '—' },
    { key: 'vendor', label: 'Fabricante / Hardware', value: d => d.vendor || '—' },
    { key: 'status', label: 'Estado', value: d => d.status === 'online' ? 'En línea' : 'Desconectado' },
    { key: 'uptime', label: 'Tiempo Conectado (Uptime)', value: d => formatUptime(d.uptime_seconds) },
    { key: 'location', label: 'Ubicación Física', value: d => d.location || '—' },
    { key: 'fortigate', label: 'FortiGate de Procedencia', value: d => d.fortigate || '—' },
  ];

  const csv = makeCsv(columns, [sampleDevice]);
  assert.ok(csv.startsWith('\uFEFF')); // BOM UTF-8
  assert.ok(csv.includes('"Tipo de Dispositivo"'));
  assert.ok(csv.includes('"Dirección IP"'));
  assert.ok(csv.includes('"Dirección MAC"'));
  assert.ok(csv.includes('"Número de Serie / Service Tag"'));
  assert.ok(csv.includes('"Nombre de Equipo / Hostname"'));
  assert.ok(csv.includes('"Usuario Detectado"'));
  assert.ok(csv.includes('"Sistema Operativo"'));
  assert.ok(csv.includes('"Interfaz"'));
  assert.ok(csv.includes('"Fabricante / Hardware"'));
  assert.ok(csv.includes('"Estado"'));
  assert.ok(csv.includes('"Tiempo Conectado (Uptime)"'));
  assert.ok(csv.includes('"Ubicación Física"'));
  assert.ok(csv.includes('"FortiGate de Procedencia"'));

  // Validar datos cotejados
  assert.ok(csv.includes('"Computadora"'));
  assert.ok(csv.includes('"192.168.10.101"'));
  assert.ok(csv.includes('"00:1A:2B:3C:4D:01"'));
  assert.ok(csv.includes('"8HG7Y23"'));
  assert.ok(csv.includes('"PC-MED-PISO3"'));
  assert.ok(csv.includes('"ricardo.martinezal"'));
  assert.ok(csv.includes('"Windows 11"'));
  assert.ok(csv.includes('"DATA"'));
  assert.ok(csv.includes('"5h 23m"'));
  assert.ok(csv.includes('"FGT-NOC-TORRE-A"'));
});


