import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, makeCsv, paginate, selectRows, inventoryFromIdfs, reportsFromData, roleLabel, AVAILABLE_PAGES, ROLE_PAGE_DEFAULTS, formatDeviceType, BASE_ROLE_CATALOG, getEffectiveRoles, formatUptime, getSaturationStatus, getSaturationLabel, makeExcelWorkbook, SUPPORT_EXPORT_COLUMNS, SUPPORT_NETWORK_EXPORT_COLUMNS, buildSupportSheets, escapeXml, sanitizeWorksheetName, EXCEL_MIME_TYPE, isSupportSegment, getSupportSegments, normalizeText, usersForDemo, projectUsersForActor, getCardRoles, getUserFilterRoles, countUsersForRoleCard, canViewPageId, getSegmentDeviceExportColumns, buildSegmentDeviceSheets } from '../src/domain.mjs';
import { createDemo } from '../src/demo.mjs';

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
  assert.equal(roleLabel('admin'), 'Administrador');
  assert.equal(roleLabel('soporte'), 'Soporte');
  assert.equal(roleLabel('viewer'), 'Consulta');
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

test('Matriz de acceso desacoplada: usuarios usa permisos separados y conexiones queda restringido a super-admin', () => {
  const isRouteAllowed = (path, userRole, allowedPages, can = () => false) => {
    const canViewPage = p => allowedPages.includes(p);
    if (path === 'conexiones') {
      return Boolean(canViewPage('conexiones') && (userRole === 'super-admin' || can('integrations.manage')));
    }
    return Boolean(canViewPage(path));
  };

  // Rol admin (sin permisos de usuarios ni integrations.manage en este fixture)
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

test('Gestión Meztli requiere permiso explícito', () => {
  assert.equal(canViewPageId('gestion-meztli', ['disponibilidad']), false);
  assert.equal(canViewPageId('gestion-meztli', ['gestion-meztli']), true);
  assert.equal(canViewPageId('entrada', ['idf']), true);
});

test('Vista general IDF comparte navegación, pero no autoriza entrada individual', () => {
  assert.ok(AVAILABLE_PAGES.some(page => page.id === 'bitacora-idf' && page.label === 'Bitácora IDF general'));
  assert.equal(canViewPageId('idf', ['bitacora-idf']), true);
  assert.equal(canViewPageId('entrada', ['bitacora-idf']), false);
  assert.equal(canViewPageId('bitacora', ['bitacora-idf']), false);
  assert.equal(canViewPageId('idf', ['idf']), true);
  assert.equal(canViewPageId('bitacora-idf', ['idf']), false);
  assert.equal(canViewPageId('idf', []), false);
});

test('BASE_ROLE_CATALOG y getEffectiveRoles normalizan roles institucionales y conservan viewer', () => {
  // 1. Catálogo base
  assert.equal(BASE_ROLE_CATALOG.length, 4);
  assert.deepEqual(BASE_ROLE_CATALOG.map(r => r.id), ['soporte', 'viewer', 'admin', 'super-admin']);

  // 2. Si roleInfo viene vacío o nulo
  const fromEmpty = getEffectiveRoles([]);
  assert.deepEqual(fromEmpty, []);
  const fromNull = getEffectiveRoles(null);
  assert.deepEqual(fromNull, []);

  // 3. Si roleInfo contenía 'viewer' y le faltaba 'soporte' (sesión antigua en caché)
  const legacyRoles = [
    { id: 'admin', title: 'admin', description: 'Operador' },
    { id: 'viewer', title: 'Viewer', description: 'Consulta' },
    { id: 'super-admin', title: 'Admin', description: 'Super' },
  ];
  const normalizedLegacy = getEffectiveRoles(legacyRoles);
  assert.ok(normalizedLegacy.some(r => r.id === 'viewer'), 'viewer debe conservarse como rol asignable');
  assert.ok(!normalizedLegacy.some(r => r.id === 'soporte'), 'no se deben inventar roles ausentes');
  assert.deepEqual(normalizedLegacy.map(r => r.id), ['viewer', 'admin', 'super-admin']);

  // 4. Roles seleccionables en UserForm según jerarquía del actor
  const isSuperAdminAllowed = ['soporte', 'viewer', 'admin', 'super-admin'];
  const isAdminAllowed = ['soporte', 'viewer', 'admin'];

  // Para super-admin:
  const superSelectable = normalizedLegacy.filter(r => isSuperAdminAllowed.includes(r.id));
  assert.deepEqual(superSelectable.map(r => r.id), ['viewer', 'admin', 'super-admin']);
  assert.equal(roleLabel(superSelectable[0].id), 'Consulta');

  // Para admin (crear usuario):
  const adminSelectable = normalizedLegacy.filter(r => isAdminAllowed.includes(r.id));
  assert.deepEqual(adminSelectable.map(r => r.id), ['viewer', 'admin']);
  assert.equal(roleLabel(adminSelectable[0].id), 'Consulta');
  assert.ok(!adminSelectable.some(r => r.id === 'super-admin'), 'Admin no puede seleccionar super-admin');
});

test('Diferenciación de roles, tarjetas y proyección de usuarios según jerarquía del actor (admin vs super-admin)', () => {
  const users = [
    { id: 'u-super', username: 'root.super', name: 'Super Admin Principal', role: 'super-admin', is_hidden: false, allowed_pages: ['resumen', 'usuarios'] },
    { id: 'u-super-hidden', username: 'root.hidden', name: 'Super Admin Oculto', role: 'super-admin', is_hidden: true, allowed_pages: ['resumen'] },
    { id: 'u-admin-1', username: 'admin.one', name: 'Administrador Uno', role: 'admin', is_hidden: false, allowed_pages: ['resumen'] },
    { id: 'u-admin-2', username: 'admin.two', name: 'Administrador Dos', role: 'admin', is_hidden: false, allowed_pages: ['resumen'] },
    { id: 'u-sop-1', username: 'tech.one', name: 'Técnico Soporte', role: 'soporte', is_hidden: false, allowed_pages: ['soporte'] },
  ];

  // ==========================================
  // 1. ACTOR: ADMIN (user?.role === 'admin')
  // ==========================================
  // A) Proyección de usuarios (usersForDemo y projectUsersForActor):
  const projectedForAdmin = usersForDemo(users, 'admin');
  assert.equal(projectedForAdmin.length, 4, 'Admin no ve cuentas con is_hidden === true');
  assert.ok(!projectedForAdmin.some(u => u.is_hidden), 'Ningún usuario tiene is_hidden visible para admin');
  assert.ok(projectedForAdmin.some(u => u.role === 'super-admin'), 'Admin ve el rol real de las cuentas visibles');

  // En la tabla, la columna Rol proyectada:
  const superProjected = projectedForAdmin.find(u => u.id === 'u-super');
  assert.equal(superProjected.role, 'super-admin');
  assert.equal(roleLabel(superProjected.role), 'Admin', 'La cuenta super-admin conserva su etiqueta interna visible para administrar jerarquía');

  // B) Tarjetas de rol (role-cards):
  const adminCards = getCardRoles('admin');
  assert.equal(adminCards.length, 3, 'Admin ve las tarjetas de los roles que puede asignar');
  assert.deepEqual(adminCards.map(c => c.id), ['soporte', 'viewer', 'admin']);
  assert.deepEqual(adminCards.map(c => roleLabel(c.id)), ['Soporte', 'Consulta', 'Administrador']);

  // Conteos en tarjetas para Admin:
  const adminSoporteCount = countUsersForRoleCard(projectedForAdmin, 'soporte', 'admin');
  const adminAdminCount = countUsersForRoleCard(projectedForAdmin, 'admin', 'admin');
  const adminSuperCount = countUsersForRoleCard(projectedForAdmin, 'super-admin', 'admin');
  assert.equal(adminSoporteCount, 1, 'Tarjeta Soporte cuenta 1 técnico');
  assert.equal(adminAdminCount, 3, 'Tarjeta Administrador contabiliza a todos los que ve como admin (2 admin + 1 super-admin proyectado)');
  assert.equal(adminSuperCount, 0, 'No existe conteo para super-admin');

  // C) Selector de filtro por Rol en la toolbar:
  const adminFilterRoles = getUserFilterRoles('admin');
  assert.equal(adminFilterRoles.length, 3, 'Admin tiene las opciones de rol de su nivel');
  assert.deepEqual(adminFilterRoles.map(r => r.id), ['soporte', 'viewer', 'admin']);
  assert.deepEqual(adminFilterRoles.map(r => roleLabel(r.id)), ['Soporte', 'Consulta', 'Administrador']);
  assert.ok(!adminFilterRoles.some(r => r.id === 'super-admin'), 'Admin no ve la opción de super-admin');

  // ==========================================
  // 2. ACTOR: SUPER-ADMIN (user?.role === 'super-admin')
  // ==========================================
  // A) Usuarios sin proyección (sigue viendo al resto como está):
  const projectedForSuper = usersForDemo(users, 'super-admin');
  assert.equal(projectedForSuper.length, 5, 'Super-admin ve todas las cuentas incluyendo ocultas');
  assert.equal(projectedForSuper.find(u => u.id === 'u-super').role, 'super-admin');
  assert.equal(roleLabel(projectedForSuper.find(u => u.id === 'u-super').role), 'Admin', 'Super-admin ve super-admin como Admin');
  assert.equal(roleLabel(projectedForSuper.find(u => u.id === 'u-admin-1').role), 'Administrador', 'Super-admin ve admin como Administrador');
  assert.equal(roleLabel(projectedForSuper.find(u => u.id === 'u-sop-1').role), 'Soporte', 'Super-admin ve soporte como Soporte');

  // B) Tarjetas de rol (role-cards):
  // Las tarjetas visibles corresponden a los roles operativos del catálogo.
  const superCards = getCardRoles('super-admin');
  assert.equal(superCards.length, 3, 'Super-admin ve las tres tarjetas operativas');
  assert.deepEqual(superCards.map(c => c.id), ['soporte', 'viewer', 'admin']);
  assert.deepEqual(superCards.map(c => roleLabel(c.id)), ['Soporte', 'Consulta', 'Administrador']);
  assert.ok(!superCards.some(c => c.id === 'super-admin'), 'getCardRoles no incluye super-admin para super-admin');
  assert.ok(!getCardRoles('admin').some(c => c.id === 'super-admin'), 'getCardRoles no incluye super-admin para admin');
  assert.ok(!getCardRoles().some(c => c.id === 'super-admin'), 'getCardRoles no incluye super-admin para ningún rol');

  // Conteos en tarjetas para Super-Admin:
  const superSoporteCount = countUsersForRoleCard(projectedForSuper, 'soporte', 'super-admin');
  const superAdminCount = countUsersForRoleCard(projectedForSuper, 'admin', 'super-admin');
  const superSuperCount = countUsersForRoleCard(projectedForSuper, 'super-admin', 'super-admin');
  assert.equal(superSoporteCount, 1, 'Tarjeta Soporte cuenta 1 técnico');
  assert.equal(superAdminCount, 4, 'Tarjeta Administrador contabiliza administradores y super-administradores');
  assert.equal(superSuperCount, 0, 'No existe conteo para super-admin');

  // C) Selector de filtro por Rol en la toolbar:
  const superFilterRoles = getUserFilterRoles('super-admin');
  assert.equal(superFilterRoles.length, 4, 'Super-admin ve todos los roles en filtro');
  assert.deepEqual(superFilterRoles.map(r => r.id), ['soporte', 'viewer', 'admin', 'super-admin']);
  assert.deepEqual(superFilterRoles.map(r => roleLabel(r.id)), ['Soporte', 'Consulta', 'Administrador', 'Admin']);

  // ==========================================
  // 3. VALIDACIÓN MODO REAL (consumiendo /api/admin/users)
  // ==========================================
  // Cuando /api/admin/users entrega datos ya proyectados por dashboard_access.py:
  const apiUsersReturnedToAdmin = [
    { id: 'u-super', username: 'root.super', name: 'Super Admin Principal', role: 'admin' },
    { id: 'u-admin-1', username: 'admin.one', name: 'Administrador Uno', role: 'admin' },
    { id: 'u-admin-2', username: 'admin.two', name: 'Administrador Dos', role: 'admin' },
    { id: 'u-sop-1', username: 'tech.one', name: 'Técnico Soporte', role: 'soporte' },
  ];
  const realAdminRows = projectUsersForActor(apiUsersReturnedToAdmin, 'admin');
  assert.equal(realAdminRows.length, 4);
  assert.equal(countUsersForRoleCard(realAdminRows, 'admin', 'admin'), 3);
  assert.equal(countUsersForRoleCard(realAdminRows, 'soporte', 'admin'), 1);

  // Cuando /api/admin/users entrega datos reales a super-admin:
  const realSuperRows = projectUsersForActor(users, 'super-admin');
  assert.equal(realSuperRows.length, 5);
  assert.equal(countUsersForRoleCard(realSuperRows, 'admin', 'super-admin'), 4, 'Tarjeta Administrador consolida 2 admin y 2 super-admin');
  assert.equal(countUsersForRoleCard(realSuperRows, 'super-admin', 'super-admin'), 0);
  assert.equal(countUsersForRoleCard(realSuperRows, 'soporte', 'super-admin'), 1);
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

test('SUPPORT_EXPORT_COLUMNS define exactamente las 8 columnas requeridas para soporte', () => {
  assert.equal(SUPPORT_EXPORT_COLUMNS.length, 8);
  const labels = SUPPORT_EXPORT_COLUMNS.map(c => c.label);
  assert.deepEqual(labels, [
    'Tipo de Dispositivo',
    'Dirección IP',
    'Dirección MAC',
    'Nombre de Equipo / Hostname',
    'Interfaz',
    'Tiempo Conectado',
    'Ubicación',
    'Piso',
  ]);

  // Verificar que ninguna columna eliminada exista en la definición
  const forbidden = [
    'Número de Serie',
    'Service Tag',
    'Usuario Detectado',
    'Sistema Operativo',
    'Fabricante',
    'Estado',
    'FortiGate de Procedencia',
  ];
  for (const f of forbidden) {
    assert.ok(!labels.includes(f), `Columna obsoleta ${f} no debe existir`);
  }
});

test('makeExcelWorkbook genera XML Spreadsheet 2003 multi-hoja con hojas separadas Computadoras e Impresoras', () => {
  const sampleComputer = {
    type: 'Computadora',
    os: 'Windows 11',
    vendor: 'Dell',
    ip: '192.168.10.101',
    mac: '00:1A:2B:3C:4D:01',
    serial: '8HG7Y23', // Columna vieja eliminada
    hostname: 'PC-MED-PISO3',
    user: 'ricardo.martinezal', // Columna vieja eliminada
    interface: 'DATA',
    status: 'online', // Columna vieja eliminada
    uptime_seconds: 19380, // 5h 23m
    location: 'IDF-01 -> 1/1/20', // Debe quedar vacía en el reporte
    fortigate: 'FGT-NOC-TORRE-A', // Columna vieja eliminada
  };

  const samplePrinter = {
    type: 'Impresora',
    vendor: 'Kyocera',
    ip: '192.168.10.200',
    mac: '00:17:C8:12:34:56',
    serial: 'KYO998877',
    hostname: 'IMP-PISO3-COLOR',
    user: 'soporte.impresion',
    interface: 'PRINTERS',
    status: 'online',
    uptime_seconds: 86400, // 1d 0h
    fortigate: 'FGT-NOC-TORRE-A',
  };

  const sheets = buildSupportSheets({
    computers: [sampleComputer],
    printers: [samplePrinter],
    includeComputers: true,
    includePrinters: true,
  });

  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, 'Computadoras');
  assert.equal(sheets[1].name, 'Impresoras');

  const xml = makeExcelWorkbook(sheets);

  // 1. Estructura y encabezados de SpreadsheetML 2003
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<?mso-application progid="Excel.Sheet"?>'));
  assert.ok(xml.includes('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'));
  assert.ok(xml.includes('</Workbook>'));
  assert.equal(EXCEL_MIME_TYPE, 'application/vnd.ms-excel;charset=utf-8');

  // 2. Multi-hoja: Separación en hojas "Computadoras" e "Impresoras"
  assert.ok(xml.includes('<Worksheet ss:Name="Computadoras">'));
  assert.ok(xml.includes('<Worksheet ss:Name="Impresoras">'));

  // 3. Encabezados exactos en ambas hojas
  for (const col of SUPPORT_EXPORT_COLUMNS) {
    assert.ok(xml.includes(`<Data ss:Type="String">${escapeXml(col.label)}</Data>`), `Header ${col.label} debe existir en el XML`);
  }

  // 4. Datos de la computadora en la hoja correspondiente
  assert.ok(xml.includes('<Data ss:Type="String">Computadora</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">192.168.10.101</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">00:1A:2B:3C:4D:01</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">PC-MED-PISO3</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">DATA</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">5h 23m</Data>'));

  // 5. Datos de la impresora en la hoja correspondiente
  assert.ok(xml.includes('<Data ss:Type="String">Impresora</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">192.168.10.200</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">00:17:C8:12:34:56</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">IMP-PISO3-COLOR</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">PRINTERS</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">1d 0h</Data>'));

  // 6. Celdas vacías para "Ubicación" y "Piso" (espacio reservado para captura técnica)
  assert.ok(xml.includes('<Cell><Data ss:Type="String"></Data></Cell>'));

  // 7. Columnas eliminadas no deben figurar en el documento
  assert.ok(!xml.includes('Número de Serie'));
  assert.ok(!xml.includes('Service Tag'));
  assert.ok(!xml.includes('Usuario Detectado'));
  assert.ok(!xml.includes('Fabricante / Hardware'));
  assert.ok(!xml.includes('FortiGate de Procedencia'));
  assert.ok(!xml.includes('8HG7Y23'));
  assert.ok(!xml.includes('KYO998877'));
  assert.ok(!xml.includes('ricardo.martinezal'));
  assert.ok(!xml.includes('soporte.impresion'));
  assert.ok(!xml.includes('FGT-NOC-TORRE-A'));
});

test('makeExcelWorkbook genera una sola hoja cuando solo se solicita una categoría', () => {
  const sampleComputer = {
    type: 'Computadora',
    ip: '10.0.0.10',
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'PC-SOLO-COMP',
    interface: 'LAN1',
    uptime_seconds: 3600,
  };

  const samplePrinter = {
    type: 'Impresora',
    ip: '10.0.0.20',
    mac: 'AA:BB:CC:DD:EE:02',
    hostname: 'IMP-SOLO-PRINT',
    interface: 'LAN2',
    uptime_seconds: 7200,
  };

  // Solo computadoras
  const compSheets = buildSupportSheets({
    computers: [sampleComputer],
    printers: [samplePrinter],
    includeComputers: true,
    includePrinters: false,
  });
  assert.equal(compSheets.length, 1);
  assert.equal(compSheets[0].name, 'Computadoras');
  const compXml = makeExcelWorkbook(compSheets);
  assert.ok(compXml.includes('<Worksheet ss:Name="Computadoras">'));
  assert.ok(!compXml.includes('<Worksheet ss:Name="Impresoras">'));
  assert.ok(compXml.includes('PC-SOLO-COMP'));
  assert.ok(!compXml.includes('IMP-SOLO-PRINT'));

  // Solo impresoras
  const printSheets = buildSupportSheets({
    computers: [sampleComputer],
    printers: [samplePrinter],
    includeComputers: false,
    includePrinters: true,
  });
  assert.equal(printSheets.length, 1);
  assert.equal(printSheets[0].name, 'Impresoras');
  const printXml = makeExcelWorkbook(printSheets);
  assert.ok(printXml.includes('<Worksheet ss:Name="Impresoras">'));
  assert.ok(!printXml.includes('<Worksheet ss:Name="Computadoras">'));
  assert.ok(printXml.includes('IMP-SOLO-PRINT'));
  assert.ok(!printXml.includes('PC-SOLO-COMP'));
});

test('buildSupportSheets y makeExcelWorkbook generan hojas independientes para los 7 widgets de soporte', () => {
  const comp = { hostname: '04820300-PC1', ip: '192.168.90.10', mac: 'AA:01', interface: 'LAN_QUETZAL', uptime_seconds: 3600 };
  const print = { hostname: 'IMP-PISO1', ip: '192.168.90.20', mac: 'AA:02', interface: 'PRINTERS', uptime_seconds: 7200 };
  const wifi = { hostname: '04820300-WIFI1', ip: '192.168.94.30', mac: 'AA:03', interface: 'meztli', uptime_seconds: 1800 };
  const uptime = { hostname: '04820300-SRV', ip: '192.168.90.5', mac: 'AA:04', interface: 'LAN_QUETZAL', uptime_seconds: 999999 };
  const unmatch = { name: 'DISPOSITIVO-DESCONOCIDO', ip: '192.168.90.40', mac: 'AA:05', interface: 'LAN_QUETZAL', status: 'online' };
  const seg1 = { name: 'Red Quetzalcóatl', interface: 'port1', subnet: '192.168.90.0/24', default_gateway: '192.168.90.1', active_leases: 140, available_ips: 114, capacity: 254, utilization_percent: 55 };
  const segCrit = { name: 'Red Saturada', interface: 'port2', subnet: '192.168.91.0/24', default_gateway: '192.168.91.1', active_leases: 230, available_ips: 24, capacity: 254, utilization_percent: 90 };

  const allSheets = buildSupportSheets({
    computers: [comp],
    printers: [print],
    institutionalWifi: [wifi],
    topUptime: [uptime],
    unmatchedOmni: [unmatch],
    networks: [seg1],
    criticalNetworks: [segCrit],
    includeComputers: true,
    includePrinters: true,
    includeInstitutionalWifi: true,
    includeTopUptime: true,
    includeUnmatchedOmni: true,
    includeNetworks: true,
    includeCriticalNetworks: true,
  });

  assert.equal(allSheets.length, 7, 'Deben generarse exactamente 7 hojas');
  const sheetNames = allSheets.map(s => s.name);
  assert.deepEqual(sheetNames, [
    'Computadoras',
    'Impresoras',
    'Institucionales WiFi',
    'Top Uptime',
    'Sin Cotejo OmniVista',
    'Redes y Estados',
    'Redes Críticas',
  ]);

  const xml = makeExcelWorkbook(allSheets);
  for (const name of sheetNames) {
    assert.ok(xml.includes(`<Worksheet ss:Name="${name}">`), `El libro debe contener la hoja "${name}"`);
  }

  // Verificar columnas de red en la hoja de Redes y Estados
  for (const col of SUPPORT_NETWORK_EXPORT_COLUMNS) {
    assert.ok(xml.includes(`<Data ss:Type="String">${escapeXml(col.label)}</Data>`), `Header de red ${col.label} debe existir en el XML`);
  }
});

test('makeExcelWorkbook y escapeXml sanitizan XML y neutralizan fórmulas maliciosas', () => {
  // Neutralización de fórmulas (inyección CSV/Spreadsheet)
  assert.ok(escapeXml('=1+1').startsWith('&apos;='));
  assert.ok(escapeXml('  +SUM(A1)').startsWith('&apos;  +'));
  assert.ok(escapeXml('\t@formula').startsWith('&apos;\t@'));
  assert.ok(escapeXml('-CMD|').startsWith('&apos;-'));

  // Escape de caracteres especiales XML
  assert.equal(escapeXml('Área <Quirófano> & "Pabellón A"'), 'Área &lt;Quirófano&gt; &amp; &quot;Pabellón A&quot;');

  // Sanitización en filas de makeExcelWorkbook
  const maliciousDevice = {
    type: 'Computadora',
    ip: '10.0.0.99',
    mac: '00:11:22:33:44:55',
    hostname: '=2+5',
    interface: '<DMZ & LOCAL>',
    uptime_seconds: 60,
  };
  const xml = makeExcelWorkbook([{ name: 'Prueba & Sanitización', rows: [maliciousDevice] }]);
  assert.ok(xml.includes('&apos;=2+5'));
  assert.ok(xml.includes('&lt;DMZ &amp; LOCAL&gt;'));
  assert.ok(xml.includes('Prueba &amp; Sanitización'));
  assert.ok(!xml.includes('<DMZ'));
});

test('makeCsv genera exportación de soporte alineada a las 8 columnas requeridas', () => {
  const sampleDevice = {
    type: 'Computadora',
    os: 'Windows 11',
    vendor: 'Dell',
    ip: '192.168.10.101',
    mac: '00:1A:2B:3C:4D:01',
    serial: '8HG7Y23',
    hostname: 'PC-MED-PISO3',
    interface: 'DATA',
    uptime_seconds: 19380,
  };

  const csv = makeCsv(SUPPORT_EXPORT_COLUMNS, [sampleDevice]);
  assert.ok(csv.startsWith('\uFEFF')); // BOM UTF-8

  // Cabecera exacta de 8 columnas
  const cleanCsv = csv.replace(/^\uFEFF/, '');
  const headerLine = cleanCsv.split('\r\n')[0];
  assert.equal(
    headerLine,
    '"Tipo de Dispositivo","Dirección IP","Dirección MAC","Nombre de Equipo / Hostname","Interfaz","Tiempo Conectado","Ubicación","Piso"'
  );

  // Línea de datos con 6 campos poblados y 2 campos vacíos para Ubicación y Piso
  const dataLine = csv.split('\r\n')[1];
  assert.equal(
    dataLine,
    '"Computadora","192.168.10.101","00:1A:2B:3C:4D:01","PC-MED-PISO3","DATA","5h 23m","",""'
  );

  // Ninguna columna vieja debe estar presente
  assert.ok(!csv.includes('Número de Serie'));
  assert.ok(!csv.includes('Usuario Detectado'));
  assert.ok(!csv.includes('Sistema Operativo'));
  assert.ok(!csv.includes('Fabricante / Hardware'));
  assert.ok(!csv.includes('FortiGate de Procedencia'));
});

test('getSegmentDeviceExportColumns y buildSegmentDeviceSheets extraen la información técnica del segmento para Excel', () => {
  const segment = {
    name: 'SSID-Quetzacoatl',
    interface: 'wl-quetzal',
    subnet: '15.40.1.0/24',
    default_gateway: '15.40.1.254',
  };

  const dev1 = {
    name: 'SEP788517AD8CF5',
    ip: '15.40.1.28',
    mac: '78:85:17:ad:8c:f6',
    vendor: 'Cisco',
    type: 'Teléfono',
    status: 'online',
    is_reserved: true,
    reserved_ip: '15.40.1.28',
    activity: 'Activo hace 5 min',
    omnivista: {
      matched: true,
      device_name: 'Videoconferencia Sistemas',
      account: '325318',
      full_name: 'Sala de Juntas B',
      department: 'Sistemas',
      position: 'Equipo Común',
      location: 'IDF 2 -> Rack A',
      ap_name: 'AP-PISO2-NORTE',
    },
  };

  const dev2 = {
    name: 'PC-ADMIN-01',
    ip: '—',
    ip_source: 'unconfirmed',
    mac: '00:11:22:33:44:55',
    vendor: 'HP',
    os: 'Windows 11',
    type: 'Computadora',
    status: 'offline',
    is_reserved: false,
    location: 'Piso 1',
  };

  const columns = getSegmentDeviceExportColumns(segment);
  assert.ok(columns.length >= 20, 'Debe incluir al menos 20 columnas de extracción técnica');

  // Verificar labels de columnas esenciales
  const labels = columns.map(c => c.label);
  assert.ok(labels.includes('Dispositivo / Equipo'));
  assert.ok(labels.includes('Dirección IP'));
  assert.ok(labels.includes('Tipo de Asignación IP'));
  assert.ok(labels.includes('Dirección MAC'));
  assert.ok(labels.includes('Tipo de Dispositivo'));
  assert.ok(labels.includes('Marca / Fabricante'));
  assert.ok(labels.includes('Estado'));
  assert.ok(labels.includes('Ubicación'));
  assert.ok(labels.includes('Punto de Acceso (AP)'));
  assert.ok(labels.includes('Cotejado OmniVista'));
  assert.ok(labels.includes('Cuenta OmniVista'));
  assert.ok(labels.includes('Segmento / Red'));
  assert.ok(labels.includes('Subred'));
  assert.ok(labels.includes('Gateway'));

  // Verificar valores extraídos de dev1
  const map1 = Object.fromEntries(columns.map(c => [c.label, c.value(dev1)]));
  assert.equal(map1['Dispositivo / Equipo'], 'Videoconferencia Sistemas');
  assert.equal(map1['Nombre Detectado / Red'], 'SEP788517AD8CF5');
  assert.equal(map1['Dirección IP'], '15.40.1.28');
  assert.equal(map1['Tipo de Asignación IP'], 'Reservada (15.40.1.28)');
  assert.equal(map1['Dirección MAC'], '78:85:17:ad:8c:f6');
  assert.equal(map1['Marca / Fabricante'], 'Cisco');
  assert.equal(map1['Estado'], 'En servicio');
  assert.equal(map1['Ubicación'], 'IDF 2 -> Rack A');
  assert.equal(map1['Punto de Acceso (AP)'], 'AP-PISO2-NORTE');
  assert.equal(map1['Cotejado OmniVista'], 'Sí');
  assert.equal(map1['Cuenta OmniVista'], '325318');
  assert.equal(map1['Usuario / Responsable'], 'Sala de Juntas B');
  assert.equal(map1['Departamento'], 'Sistemas');
  assert.equal(map1['Segmento / Red'], 'SSID-Quetzacoatl');
  assert.equal(map1['Subred'], '15.40.1.0/24');
  assert.equal(map1['Gateway'], '15.40.1.254');

  // Verificar valores extraídos de dev2 con IP no confirmada y sin reserva
  const map2 = Object.fromEntries(columns.map(c => [c.label, c.value(dev2)]));
  assert.equal(map2['Dirección IP'], 'Pendiente de confirmar');
  assert.equal(map2['Tipo de Asignación IP'], 'Dinámica (DHCP)');
  assert.equal(map2['Cotejado OmniVista'], 'No');

  // buildSegmentDeviceSheets: cuando no hay filtro genera una sola hoja
  const sheetsAll = buildSegmentDeviceSheets({
    segment,
    allDevices: [dev1, dev2],
    filteredDevices: [dev1, dev2],
  });
  assert.equal(sheetsAll.length, 1);
  assert.equal(sheetsAll[0].name, 'SSID-Quetzacoatl');
  assert.equal(sheetsAll[0].rows.length, 2);

  // buildSegmentDeviceSheets: cuando hay filtro genera hojas separadas "Filtrados" y "Todos"
  const sheetsFiltered = buildSegmentDeviceSheets({
    segment,
    allDevices: [dev1, dev2],
    filteredDevices: [dev1],
  });
  assert.equal(sheetsFiltered.length, 2);
  assert.equal(sheetsFiltered[0].name, 'Filtrados (1)');
  assert.equal(sheetsFiltered[0].rows.length, 1);
  assert.equal(sheetsFiltered[1].name, 'Todos (2)');
  assert.equal(sheetsFiltered[1].rows.length, 2);

  // Validar generación de XML Workbook con makeExcelWorkbook
  const xml = makeExcelWorkbook(sheetsFiltered);
  assert.ok(xml.includes('<Worksheet ss:Name="Filtrados (1)">'));
  assert.ok(xml.includes('<Worksheet ss:Name="Todos (2)">'));
  assert.ok(xml.includes('Videoconferencia Sistemas'));
  assert.ok(xml.includes('15.40.1.28'));
  assert.ok(xml.includes('15.40.1.0/24'));
});

test('support discovers every published network without a name or VLAN allowlist', () => {
  const rows = [
    { name: 'Mixcoatl' }, { interface: 'SSID-Una-Red-Futura' }, { name: 'CCTV', vlan: 110 },
    { name: 'Laboratorio' }, { vlan: 777 }, { subnet: '10.77.0.0/24' },
  ];
  for (const row of rows) assert.equal(isSupportSegment(row), true);
  for (const row of [null, undefined, {}, '', 123, []]) assert.equal(isSupportSegment(row), false);
  assert.deepEqual(getSupportSegments([...rows, null, {}]), rows);
  assert.deepEqual(getSupportSegments(createDemo().segments), createDemo().segments);
  assert.deepEqual(getSupportSegments(null), []);
});

test('missing DHCP metrics remain unknown in saturation and exports', () => {
  assert.equal(getSaturationStatus({ capacity: null, utilization_percent: null }), 'unknown');
  assert.equal(getSaturationLabel('unknown'), 'No informado');
  const row = { name: 'Mixcoatl', capacity: null, utilization_percent: null, active_leases: null, available_ips: null };
  for (const key of ['capacity', 'active_leases', 'available_ips', 'utilization']) {
    assert.equal(SUPPORT_NETWORK_EXPORT_COLUMNS.find(c => c.key === key).value(row), '—');
  }
});

test('normalizeText normaliza diacríticos, mayúsculas y variantes fonéticas para búsquedas', () => {
  assert.equal(normalizeText('Tláloc'), 'tlaloc');
  assert.equal(normalizeText('TLÁLOC'), 'tlaloc');
  assert.equal(normalizeText('tlaloc'), 'tlaloc');

  assert.equal(normalizeText('Ehécatl'), 'ehecatl');
  assert.equal(normalizeText('EHÉCATL'), 'ehecatl');
  assert.equal(normalizeText('ehecatl'), 'ehecatl');

  assert.equal(normalizeText('Quetzalcóatl'), 'quetzalcoatl');
  assert.equal(normalizeText('QUETZALCÓATL'), 'quetzalcoatl');
  assert.equal(normalizeText('quetzalcoatl'), 'quetzalcoatl');
  assert.equal(normalizeText('quetzacoatl'), 'quetzalcoatl'); // Variante sin 'l'
  assert.equal(normalizeText('Quetzacoatl'), 'quetzalcoatl');

  assert.equal(normalizeText('Tonatiuh'), 'tonatiuh');
  assert.equal(normalizeText('Meztli'), 'meztli');

  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});


