const DAY = 86400000;
export const isOficio = user => /oficio/i.test(String(user.description || ''));
export const isTemporary = user => isOficio(user) || /\btemporal\b/i.test(`${user.description || ''} ${user.position || ''}`) || user.customConcession === true;
export function expiry(user) {
  const raw = user.dateOfEffective;
  if (raw == null || raw === '') return null;
  const value = Number.isFinite(Number(raw)) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(value) && value > 0 && value <= 8640000000000000 ? value : null;
}
export function devicePlatform(device) {
  const os = String(device.deviceOS || device.os || device.forti?.os || '').toLowerCase();
  if (/android/.test(os)) return 'android';
  if (/\bios\b|iphone|ipad|ipados/.test(os)) return 'ios';
  if (/windows|win32|win64/.test(os)) return 'windows';
  if (/macos|mac os|os x|darwin|^mac$/.test(os)) return 'macos';
  if (/linux|ubuntu|debian|fedora|centos/.test(os)) return 'linux';
  return 'unknown';
}
export const PLATFORM_LABELS = { android: 'Android', ios: 'iOS / iPadOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: 'Sistema no identificado' };
function deviceKey(device, fallback) {
  const mac = String(device.deviceMac || device.mac || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  return mac.length === 12 && !['000000000000', 'ffffffffffff'].includes(mac) ? `mac:${mac}` : device.id ? `id:${device.id}` : fallback;
}
export function userDevices(user) {
  const devices = new Map();
  (Array.isArray(user.devices) ? user.devices : []).forEach((device, i) => { if (device && typeof device === 'object') devices.set(deviceKey(device, `row:${i}`), device); });
  return [...devices.values()];
}
export function deviceType(device) {
  const platform = devicePlatform(device);
  const metadata = `${device.deviceCategory || ''} ${device.deviceFamily || ''}`.toLowerCase();
  if (/printer|impresora/.test(metadata)) return 'printers';
  if (['android', 'ios'].includes(platform) || /phone|mobile|tablet|móvil/.test(metadata)) return 'mobile';
  if (['windows', 'macos', 'linux'].includes(platform) || /computer|desktop|laptop|notebook|workstation/.test(metadata)) return 'computers';
  return 'other';
}
const hasPlatform = (user, platform) => userDevices(user).some(device => devicePlatform(device) === platform);
const hasType = (user, type) => userDevices(user).some(device => deviceType(device) === type);
const active = user => /^(1|online|active|enabled|normal)$/i.test(String(user.status ?? ''));
const inactive = user => /^(0|offline|inactive|disabled)$/i.test(String(user.status ?? ''));
const remaining = (user, now) => isTemporary(user) && expiry(user) !== null ? expiry(user) - now : null;
const within = (user, now, days) => { const time = remaining(user, now); return time !== null && time > 0 && time <= days * DAY; };

export const METRICS = [
  ['accounts', 'Total de cuentas', 'Cuentas consultadas', () => true],
  ['temporary', 'Total temporales', 'Oficio, temporal o concesión personalizada', isTemporary],
  ['oficios', 'Cuentas por oficio', 'Descripción con Oficio', isOficio],
  ['valid', 'Concesiones vigentes', 'Temporales con fecha futura', (u, now) => remaining(u, now) > 0],
  ['expiring24', 'Vencen en 24 horas', 'Temporales próximas a vencer', (u, now) => within(u, now, 1)],
  ['expiring7', 'Vencen entre 24 h y 7 días', 'Más de 24 horas y hasta 7 días; excluye las próximas 24 horas', (u, now) => within(u, now, 7) && !within(u, now, 1)],
  ['expired', 'Concesiones vencidas', 'Temporales cuya fecha ya pasó', (u, now) => remaining(u, now) !== null && remaining(u, now) <= 0],
  ['no-expiry', 'Temporales sin fecha', 'Sin vencimiento válido informado', u => isTemporary(u) && expiry(u) === null],
  ['non-temporary', 'Sin temporal identificada', 'No se identificó concesión temporal', u => !isTemporary(u)],
  ['active', 'Cuentas activas', 'Estado activo informado por OmniVista', active],
  ['inactive-by-crosscheck', 'Inactivas por cotejo', 'Autenticación vacía en OmniVista y sin coincidencias en FortiGate; consultas completas.', u => u.activityAssessment?.status === 'inactive'],
  ['activity-unverified', 'Actividad sin verificar', 'Evidencia insuficiente para confirmar inactividad.', u => !u.activityAssessment || u.activityAssessment.status === 'unknown'],
  ['inactive', 'Inactivas según OmniVista', 'Estado inactivo informado por OmniVista', inactive],
  ['unknown-status', 'Estado no identificado', 'Sin estado activo o inactivo reconocido', u => !active(u) && !inactive(u)],
  ['with-devices', 'Cuentas con equipos', 'Al menos un dispositivo asociado', u => userDevices(u).length > 0],
  ['without-devices', 'Cuentas sin equipos', 'Sin dispositivos asociados en la consulta', u => userDevices(u).length === 0],
  ['multiple-devices', 'Usuarios con 2 o más equipos', 'Dos o más dispositivos distintos; incluye los de 5 o más', u => userDevices(u).length >= 2],
];
const temporalIds = new Set(['temporary', 'oficios', 'valid', 'expiring24', 'expiring7', 'expired', 'no-expiry']);
const statusIds = new Set(['active', 'inactive', 'unknown-status']);
export const ALTAS_WIDGET_CATALOG = [
  ...METRICS.filter(([id]) => !statusIds.has(id)).map(([id, title, description]) => ({ id: `altas-${id}`, title, description, kind: 'metric', metric: id, scope: temporalIds.has(id) ? 'oficios' : 'all', module: 'Gestión de altas', min: 3, size: 3 })),
  ...[['device-total', 'Dispositivos asociados', 'Equipos distintos por MAC o identificador.', 'devices'], ['unassociated', 'Dispositivos sin cuenta', 'Terminales sin cuenta coincidente; requiere consulta completa.', 'unassociated'], ['top-devices', 'Usuarios con más dispositivos', 'Ranking de cuentas por equipos distintos asociados.', 'ranking'], ['account-status', 'Estado de cuentas en OmniVista', 'Activas, inactivas y sin estado informado; distinto de actividad por cotejo.', 'statuses'], ['platforms', 'Sistemas operativos', 'Distribución de dispositivos por sistema reportado.', 'platforms'], ['device-types', 'Tipos de dispositivo', 'Móviles, computadoras, impresoras y otros equipos.', 'types'], ['departments', 'Cuentas por departamento', 'Departamentos con más cuentas consultadas.', 'departments'], ['profiles', 'Perfiles de acceso', 'Distribución de cuentas por perfil de red.', 'profiles'], ['recent', 'Altas de los últimos 7 días', 'Cuentas con fecha de alta disponible y reciente.', 'recent']].map(([id, title, description, kind]) => ({ id: `altas-${id}`, title, description, kind, scope: 'all', module: 'Gestión de altas', min: ['devices','unassociated','recent'].includes(kind) ? 3 : 4, size: ['devices','unassociated','recent'].includes(kind) ? 3 : 4 })),
];
export const ALTAS_DEFAULT_LAYOUT = ['accounts', 'inactive-by-crosscheck', 'activity-unverified', 'temporary', 'expiring24', 'expired', 'device-total', 'top-devices', 'platforms', 'departments', 'profiles'].map(id => { const widget = ALTAS_WIDGET_CATALOG.find(item => item.id === `altas-${id}`); return { id: widget.id, size: widget.size }; });

// Resolve retired widgets before the shared layout sanitizer drops unknown IDs.
// Keep position/width of the first occurrence, and avoid duplicate replacements.
export function migrateAltasWidgetLayout(value) {
  if (!Array.isArray(value)) return value;
  const aliases = { 'altas-five-devices': 'altas-multiple-devices',
    ...Object.fromEntries(Object.keys(PLATFORM_LABELS).map(key => [`altas-${key}`, 'altas-platforms'])),
    ...Object.fromEntries([...statusIds].map(key => [`altas-${key}`, 'altas-account-status'])) };
  const seen = new Set();
  return value.flatMap(widget => {
    if (!widget || typeof widget !== 'object') return [widget];
    const id = aliases[widget.id] || widget.id;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ ...widget, id }];
  });
}

export function filterAltasUsers(users, filter, now = Date.now()) {
  if (!filter) return users;
  const metric = METRICS.find(item => item[0] === filter.id);
  if (metric) return users.filter(user => metric[3](user, now));
  if (filter.id === 'platform') return users.filter(user => hasPlatform(user, filter.value));
  if (filter.id === 'type') return users.filter(user => hasType(user, filter.value));
  if (filter.id === 'username') return users.filter(user => user.username === filter.value);
  if (['department', 'accessRoleProfile'].includes(filter.id)) return users.filter(user => String(user[filter.id] || '').trim() === filter.value);
  if (filter.id === 'recent') return users.filter(user => { const time = Number(user.registeredAt); return time > 0 && time <= now && now-time <= 7*DAY; });
  return users;
}
export function buildAltasAnalytics(users, now = Date.now()) {
  const devices = new Map();
  const platforms = Object.fromEntries(Object.keys(PLATFORM_LABELS).map(key => [key, 0]));
  const types = { mobile: 0, computers: 0, printers: 0, other: 0 };
  const groups = { departments: new Map(), profiles: new Map() };
  const ranking = users.map((user, userIndex) => {
    const associated = userDevices(user);
    associated.forEach((device, i) => { const key = deviceKey(device, `user:${userIndex}:${i}`); if (!devices.has(key)) devices.set(key, device); });
    for (const [kind, field] of [['departments','department'],['profiles','accessRoleProfile']]) { const key = String(user[field] || '').trim(); groups[kind].set(key, (groups[kind].get(key) || 0) + 1); }
    return { username: user.username, fullName: user.fullName, count: associated.length };
  }).filter(user => user.count > 0).sort((a,b) => b.count-a.count || String(a.username).localeCompare(String(b.username)));
  for (const device of devices.values()) { platforms[devicePlatform(device)]++; types[deviceType(device)]++; }
  return {
    counts: Object.fromEntries(METRICS.map(([id,,,test]) => [id, users.filter(user => test(user, now)).length])),
    deviceCount: devices.size, platforms, types, ranking,
    recent: filterAltasUsers(users, {id:'recent'}, now).length,
    departments: [...groups.departments].sort((a,b) => b[1]-a[1]), profiles: [...groups.profiles].sort((a,b) => b[1]-a[1]),
  };
}
