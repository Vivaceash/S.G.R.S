export const WIDGET_SIZES = [
  { value: 3, label: '¼ de fila' }, { value: 4, label: '⅓ de fila' },
  { value: 6, label: '½ fila' }, { value: 8, label: '⅔ de fila' },
  { value: 9, label: '¾ de fila' }, { value: 12, label: 'Fila completa' },
];
export const WIDGET_CATALOG = [
  { id: 'metrics', title: 'Indicadores de infraestructura', module: 'Dashboard', description: 'Direcciones, equipos activos, DHCP y presión por red.', min: 6, size: 12 },
  { id: 'segments', title: 'Segmentos de red y VLANs', module: 'Dashboard', description: 'Capacidad, asignaciones y consulta de dispositivos por segmento.', min: 6, size: 12 },
  { id: 'network', title: 'Usuarios conectados por red', module: 'Dashboard', description: 'Distribución de concesiones DHCP y acceso a los equipos de cada red.', min: 6, size: 12 },
  { id: 'devices', title: 'Estado de dispositivos', module: 'Dispositivos', description: 'Equipos en línea, fuera de línea y sin estado reportado.', min: 3, size: 4 },
  { id: 'ips', title: 'Disponibilidad de direcciones IP', module: 'Direcciones IP', description: 'Direcciones libres y ocupadas en el inventario local.', min: 3, size: 4 },
  { id: 'incidents', title: 'Incidencias abiertas por IDF', module: 'Registro IDF', description: 'Incidencias pendientes, agrupadas por cuarto de telecomunicaciones.', min: 4, size: 6 },
  { id: 'audit', title: 'Últimos movimientos', module: 'Bitácora', description: 'Actividad reciente, responsable y fecha del registro.', min: 4, size: 6 },
  { id: 'forti', title: 'Recursos de FortiGate', module: 'FortiGate', description: 'CPU, memoria y sesiones activas del firewall.', min: 3, size: 4 },
  { id: 'expiring', title: 'Concesiones próximas a vencer', module: 'Gestión de altas', description: 'Cuentas por oficio que vencen dentro de las próximas 72 horas.', min: 4, size: 6 },
  { id: 'aps', title: 'Estado de access points', module: 'Access Points', description: 'Estado en vivo de los AP y sus clientes conectados.', min: 3, size: 4 },
  { id: 'cctv', title: 'Inventario CCTV', module: 'CCTV', description: 'Cámaras documentadas, bajas y registros por revisar.', min: 3, size: 4 },
  { id: 'stock', title: 'Existencias bajas de soporte', module: 'Soporte', description: 'Artículos del IDF 3 con cinco unidades o menos.', min: 4, size: 6 },
  { id: 'support-log', title: 'Retiros recientes de soporte', module: 'Soporte', description: 'Últimos retiros de inventario con responsable y fecha.', min: 4, size: 6 },
  { id: 'network-pressure', title: 'Redes con mayor ocupación', module: 'Dashboard', description: 'Prioriza los segmentos con menos espacio DHCP disponible.', min: 4, size: 6 },
  { id: 'device-types', title: 'Equipos por tipo', module: 'Dispositivos', description: 'Distribución del inventario consultado por tipo de dispositivo.', min: 4, size: 6 },
  { id: 'offline-devices', title: 'Dispositivos fuera de línea', module: 'Dispositivos', description: 'Equipos reportados fuera de línea, con su dirección IP.', min: 4, size: 6 },
  { id: 'recent-incidents', title: 'Incidencias recientes', module: 'Registro IDF', description: 'Últimos reportes con ubicación, fecha y estado.', min: 4, size: 6 },
  { id: 'services', title: 'Conexión con los servicios', module: 'Dashboard', description: 'Resultado de la última comprobación de FortiGate y OmniVista.', min: 3, size: 4 },
];
export const DEFAULT_WIDGET_LAYOUT = ['metrics', 'segments', 'network'].map(id => ({ id, size: 12 }));

export function sanitizeWidgetLayout(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  return value.flatMap(item => {
    const definition = WIDGET_CATALOG.find(widget => widget.id === item?.id);
    if (!definition || seen.has(item.id)) return [];
    seen.add(item.id);
    const size = WIDGET_SIZES.some(option => option.value === item.size && item.size >= definition.min) ? item.size : definition.size;
    return [{ id: item.id, size }];
  });
}

export function widgetAllowed(id, session) {
  const { can, canViewPage: page, canViewSubmodule: sub, user } = session;
  if (['metrics', 'segments', 'network', 'network-pressure', 'services'].includes(id)) return page('resumen');
  if (['devices', 'device-types', 'offline-devices'].includes(id)) return page('dispositivos') && can('dashboard.read');
  if (id === 'ips') return page('disponibilidad') && can('inventory.read');
  if (['incidents', 'recent-incidents'].includes(id)) return can('activity.read') && ((page('idf') && can('idf.read') && sub('idf', 'activity')) || page('bitacora-idf'));
  if (id === 'audit') return page('bitacora') && can('activity.read');
  if (id === 'forti') return user?.role === 'super-admin' && can('traffic.read');
  if (id === 'expiring') return sub('altas', 'oficios') && can('dashboard.read');
  if (id === 'aps') return sub('aps', 'live') && can('inventory.read');
  if (id === 'cctv') return sub('cctv', 'updated') && can('inventory.read');
  if (id === 'stock') return can('inventory.read') && (sub('soporte', 'inventory') || sub('soporte', 'log'));
  if (id === 'support-log') return sub('soporte', 'log') && can('activity.read');
  return false;
}

export function expiringConcessions(users, now) {
  return users.filter(user => String(user.description || '').toLowerCase().includes('oficio'))
    .map(user => ({ ...user, remaining: Number(user.dateOfEffective) - now }))
    .filter(user => Number.isFinite(user.remaining) && user.remaining > 0 && user.remaining <= 72 * 3600000)
    .sort((a, b) => a.remaining - b.remaining);
}

export function networkPressure(segments) {
  return segments.filter(row => Number(row.capacity) > 0 && Number.isFinite(Number(row.active_leases)) && Number(row.active_leases) >= 0)
    .map(row => ({ ...row, occupiedPercent: Number(row.active_leases) / Number(row.capacity) * 100 }))
    .sort((a, b) => b.occupiedPercent - a.occupiedPercent);
}
