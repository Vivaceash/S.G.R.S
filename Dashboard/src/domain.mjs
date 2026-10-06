export const LOCALE = 'es-MX';
export const TIME_ZONE = 'America/Mexico_City';
export const roleLabel = role => role === 'super-admin' ? 'Admin' : role === 'admin' ? 'Administrador' : role === 'soporte' ? 'Soporte' : (role || '');

export const AVAILABLE_PAGES = [
  { id: 'resumen', label: 'Dashboard Operativo' },
  { id: 'dispositivos', label: 'Dispositivos' },
  { id: 'disponibilidad', label: 'Direcciones IP' },
  { id: 'bitacora', label: 'Bitácora' },
  { id: 'idf', label: 'Registro IDF' },
  { id: 'aps', label: 'Access Points' },
  { id: 'cctv', label: 'CCTV' },
  { id: 'altas', label: 'Gestión de altas' },
  { id: 'soporte', label: 'Dashboard de Soporte' },
  { id: 'usuarios', label: 'Usuarios y privilegios' },
  { id: 'conexiones', label: 'Conexiones API' },
];

export const BASE_ROLE_CATALOG = [
  { id: 'soporte', title: 'Soporte', description: 'Atención y diagnóstico técnico: consulta de dispositivos, fichas técnicas y DHCP.' },
  { id: 'admin', title: 'Administrador', description: 'Administra la operación: inventario, visitas e incidencias de IDF y gestión de usuarios.' },
  { id: 'super-admin', title: 'Admin', description: 'Gestiona cuentas, privilegios modulares, conexiones y consultas técnicas.' },
];

export function getEffectiveRoles(roleInfo, actorRole) {
  if (!Array.isArray(roleInfo)) return [];
  const roles = BASE_ROLE_CATALOG.flatMap(base => {
    const existing = roleInfo.find(r => r?.id === base.id);
    return existing ? [{ ...base, ...existing, title: base.title }] : [];
  });
  if (actorRole === 'admin') {
    return roles.filter(r => r.id !== 'super-admin');
  }
  return roles;
}

export function projectUsersForActor(users, actorRole) {
  if (!Array.isArray(users)) return [];
  if (actorRole === 'super-admin') return users;
  return users.filter(user => !user.is_hidden).map(({ is_hidden, allowed_pages, ...user }) => ({
    ...user,
    role: user.role === 'super-admin' ? 'admin' : user.role,
  }));
}

export function usersForDemo(users, actorRole) {
  return projectUsersForActor(users, actorRole);
}

export function getCardRoles(actorRole, roleInfo) {
  const catalog = Array.isArray(roleInfo) && roleInfo.length > 0 ? roleInfo : BASE_ROLE_CATALOG;
  const roles = getEffectiveRoles(catalog, actorRole);
  return roles.filter(r => r.id !== 'super-admin');
}

export function getUserFilterRoles(actorRole, roleInfo) {
  const catalog = Array.isArray(roleInfo) && roleInfo.length > 0 ? roleInfo : BASE_ROLE_CATALOG;
  const roles = getEffectiveRoles(catalog, actorRole);
  if (actorRole === 'super-admin') {
    return roles;
  }
  return roles.filter(r => r.id !== 'super-admin');
}

export function countUsersForRoleCard(users, roleId, actorRole) {
  if (!Array.isArray(users)) return 0;
  return users.filter(u => {
    const effectiveRole = u.role === 'super-admin' ? 'admin' : u.role;
    return effectiveRole === roleId;
  }).length;
}

export const ROLE_PAGE_DEFAULTS = {
  soporte: ['soporte'],
  admin: ['resumen', 'dispositivos', 'disponibilidad', 'bitacora', 'idf', 'aps', 'cctv', 'altas', 'usuarios'],
  'super-admin': ['resumen', 'dispositivos', 'disponibilidad', 'bitacora', 'idf', 'aps', 'cctv', 'altas', 'soporte', 'usuarios', 'conexiones'],
  viewer: ['resumen', 'dispositivos', 'disponibilidad', 'bitacora', 'idf', 'aps', 'cctv', 'altas'],
};
export const segmentKey = segment => JSON.stringify([segment.id ?? '', segment.interface ?? '']);
const ipv4 = value => {
  const parts = String(value ?? '').trim().split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    ? parts.reduce((n, p) => n * 256 + Number(p), 0) : null;
};
export function ipInSegment(address, segment) {
  const ip = ipv4(address);
  if (ip === null || !segment) return false;
  const [network, prefix] = String(segment.subnet || '').split('/');
  const base = ipv4(network) ?? ipv4(segment.default_gateway);
  let mask = ipv4(segment.netmask);
  if (prefix !== undefined && /^\d+$/.test(prefix) && Number(prefix) <= 32) mask = (0xffffffff << (32 - Number(prefix))) >>> 0;
  if (prefix === '0') mask = 0;
  if (base !== null && mask !== null) {
    const inverse = (~mask) >>> 0;
    if ((inverse & (inverse + 1)) === 0) return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
  }
  return (segment.ip_ranges || []).some(range => {
    const [start, end] = String(range).split('-').map(ipv4);
    return start !== null && end != null && ip >= start && ip <= end;
  });
}
export function deviceInSegment(device, segment) {
  if (!segment) return false;
  if (ipInSegment(device.ip, segment)) return true;
  if (device.is_reserved && !device.ip && ipInSegment(device.reserved_ip, segment)) return true;
  return device.ip_source === 'unconfirmed' && Boolean(device.interface) && device.interface === segment.interface;
}
export function getSegmentDevices(devices, segment) {
  if (!Array.isArray(devices) || !segment) return [];
  return devices.filter(device => deviceInSegment(device, segment));
}

export function isMeztliSegment(segment) {
  return /\bmeztli\b/.test(normalizeText(`${segment?.name || ''} ${segment?.interface || ''}`));
}
export function getOverviewSegmentDevices(devices, segment) {
  if (!isMeztliSegment(segment)) return getSegmentDevices(devices, segment);
  const mac = value => String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  return (segment.dhcp_clients || []).map(lease => {
    const observed = (devices || []).find(device => device.interface === segment.interface
      && (lease.mac ? mac(device.mac) === mac(lease.mac) : device.ip === lease.ip));
    return { ...observed, name: observed?.name || lease.hostname || lease.mac || lease.ip || 'Cliente DHCP',
      ip: lease.ip, mac: lease.mac || observed?.mac, interface: segment.interface,
      status: 'online', ip_source: 'dhcp', activity: 'Concesión DHCP activa' };
  });
}

export const SUPPORT_ALLOWED_NETWORKS = ['meztli', 'tona', 'tlalo', 'quetzal', 'ehecatl'];

const SUPPORT_VLAN_MAP = {
  '90': 'quetzal',
  '91': 'tlalo',
  '92': 'ehecatl',
  '93': 'tona',
  '94': 'meztli',
};

export function normalizeText(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/quetzac/g, 'quetzalc');
}

export function isSupportSegment(segment) {
  if (!segment || typeof segment !== 'object') return false;

  let text = [
    segment.name,
    segment.interface,
    segment.vlan,
    segment.description,
  ].map(normalizeText).join(' ');

  const vlanStr = String(segment.vlan ?? '');
  for (const [vlanNum, alias] of Object.entries(SUPPORT_VLAN_MAP)) {
    if (new RegExp(`(?:^|\\bvlan[\\s-_]*|\\b)${vlanNum}\\b`, 'i').test(vlanStr) ||
        new RegExp(`\\bvlan[\\s-_]*${vlanNum}\\b`, 'i').test(text)) {
      text += ` ${alias}`;
    }
  }

  return SUPPORT_ALLOWED_NETWORKS.some(pattern => text.includes(pattern));
}

export function getSupportSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.filter(isSupportSegment);
}

export function formatDeviceType(typeOrDevice, osOrName = '', nameOrVendor = '', vendorParam = '') {
  let type = '';
  let os = '';
  let name = '';
  let vendor = '';

  if (typeOrDevice && typeof typeOrDevice === 'object') {
    type = typeOrDevice.type || '';
    os = typeOrDevice.os || typeOrDevice.raw?.os_name || '';
    name = typeOrDevice.name || '';
    vendor = typeOrDevice.vendor || '';
  } else {
    type = typeOrDevice || '';
    if (vendorParam !== '') {
      os = osOrName || '';
      name = nameOrVendor || '';
      vendor = vendorParam || '';
    } else if (nameOrVendor !== '') {
      const testOs = String(osOrName).toLowerCase();
      if (/windows|macos|mac_os|mac\s*os|os\s*x|android|ios|iphone|ipad|ipados|linux/.test(testOs)) {
        os = osOrName;
        name = nameOrVendor;
      } else {
        name = osOrName;
        vendor = nameOrVendor;
      }
    } else {
      const testOs = String(osOrName).toLowerCase();
      if (/windows|macos|mac_os|mac\s*os|os\s*x|android|ios|iphone|ipad|ipados|linux/.test(testOs)) {
        os = osOrName;
      } else {
        name = osOrName;
      }
    }
  }

  const osLower = String(os || '').toLowerCase();
  if (/(windows|macos|mac_os|mac\s*os|os\s*x)/i.test(osLower)) {
    return 'Computadora';
  }
  if (/(android|ios|iphone|ipad|ipados)/i.test(osLower)) {
    return 'Teléfono';
  }

  if (type === 'Computadora' || type === 'Teléfono' || type === 'Impresora') return type;
  if (type === 'Móvil') return 'Teléfono';

  const text = `${type || ''} ${name || ''} ${vendor || ''}`.toLowerCase();
  if (/(phone|iphone|android|movil|móvil|celular|ipad|tablet|poco|redmi|xiaomi|samsung|huawei|motorola|oppo|vivo|realme|galaxy)/i.test(text)) {
    return 'Teléfono';
  }
  if (/(desktop|laptop|pc|macbook|imac|thinkpad|workstation|dell|lenovo|hp|computer)/i.test(text)) {
    return 'Computadora';
  }
  if (/(printer|impresora|kyocera|ricoh|epson)/i.test(text)) {
    return 'Impresora';
  }

  if (!type || type === 'Unknown' || type === 'Dispositivo') return 'Desconocido';
  return type;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatLocation(location, vendor = '', segmentName = '') {
  if (!location || location === '—') return '—';
  let clean = String(location).trim();
  if (segmentName && clean.includes(segmentName)) {
    const esc = escapeRegex(segmentName);
    clean = clean.replace(new RegExp(`\\s*[·\\-/]\\s*${esc}\\b`, 'gi'), '').replace(new RegExp(`\\b${esc}\\s*[·\\-/]\\s*`, 'gi'), '').trim();
  }
  if (vendor && clean.startsWith(`${vendor} ·`)) {
    clean = clean.replace(`${vendor} ·`, '').trim();
  }
  if (vendor && clean.toLowerCase() === vendor.toLowerCase()) {
    return '—';
  }
  return clean || '—';
}
export const number = value => value == null ? '—' : new Intl.NumberFormat(LOCALE).format(value);
export const dateTime = value => {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE,
  }).format(date);
};
export const formatUptime = seconds => {
  if (seconds == null || Number.isNaN(Number(seconds))) return '—';
  const sec = Math.max(0, Math.floor(Number(seconds)));
  if (sec < 60) return '< 1m';
  if (sec < 3600) {
    const mins = Math.floor(sec / 60);
    return `${mins}m`;
  }
  if (sec < 86400) {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  return `${days}d ${hours}h`;
};
export const statusNames = {
  online: 'En servicio', offline: 'Fuera de línea', normal: 'Operativo', warning: 'Con alerta',
  critical: 'Crítico', available: 'Disponible', occupied: 'Asignada', reserved: 'Reservada',
  approved: 'Aprobado', pending: 'Pendiente', review: 'En revisión', rejected: 'Rechazado',
  open: 'Abierto', resolved: 'Resuelto', in_progress: 'En atención', low: 'Stock bajo', unknown: 'Sin verificar',
};
export const statusTone = status => ['online', 'normal', 'available', 'approved', 'resolved'].includes(status) ? 'success'
  : ['warning', 'pending', 'low', 'in_progress'].includes(status) ? 'warning'
    : ['offline', 'critical', 'rejected', 'open'].includes(status) ? 'danger' : status === 'review' ? 'info' : 'neutral';

export function getUtilizationTone(percent) {
  const p = Number(percent) || 0;
  if (p < 40) return 'green';
  if (p < 70) return 'yellow';
  if (p < 85) return 'orange';
  return 'red';
}

export function getUtilizationColor(percent) {
  const tone = getUtilizationTone(percent);
  switch (tone) {
    case 'green': return '#19BF3E';
    case 'yellow': return '#d97706';
    case 'orange': return '#ea580c';
    case 'red': return '#ae1234';
    default: return '#19BF3E';
  }
}

export function getSaturationStatus(segmentOrPercent) {
  if (typeof segmentOrPercent === 'object' && segmentOrPercent !== null) {
    if (segmentOrPercent.saturation_status) return segmentOrPercent.saturation_status;
    return getSaturationStatus(segmentOrPercent.utilization_percent);
  }
  const p = Number(segmentOrPercent) || 0;
  if (p >= 80) return 'critical';
  if (p >= 50) return 'warning';
  return 'normal';
}

export function getSaturationLabel(status) {
  switch (status) {
    case 'critical': return 'Saturada';
    case 'warning': return 'Uso medio';
    case 'normal':
    default: return 'Disponible';
  }
}

// Every exported value is quoted; spreadsheet formulas and leading controls are neutralized.
export function csvCell(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function makeCsv(columns, rows) {
  return '\uFEFF' + [columns.map(c => csvCell(c.label)).join(','), ...rows.map(row => columns.map(c => csvCell(c.value ? c.value(row) : row[c.key])).join(','))].join('\r\n');
}

export const EXCEL_MIME_TYPE = 'application/vnd.ms-excel;charset=utf-8';

// Neutralizes spreadsheet formulas/leading controls and escapes XML special characters
export function escapeXml(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) {
    text = `'${text}`;
  }
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function sanitizeWorksheetName(name, fallback = 'Hoja') {
  const clean = String(name || fallback)
    .replace(/[:\\/?*[\]]/g, '')
    .trim()
    .slice(0, 31);
  return clean || fallback;
}

export const SUPPORT_EXPORT_COLUMNS = [
  {
    key: 'device_type',
    label: 'Tipo de Dispositivo',
    value: dev => formatDeviceType(dev.type, dev.os || dev.omnivista?.os || dev.raw?.os_name, dev.hostname || dev.detected_device || dev.omnivista?.device_name || dev.name, dev.vendor) || 'Dispositivo',
  },
  {
    key: 'ip',
    label: 'Dirección IP',
    value: dev => dev.ip || '—',
  },
  {
    key: 'mac',
    label: 'Dirección MAC',
    value: dev => dev.mac || '—',
  },
  {
    key: 'hostname',
    label: 'Nombre de Equipo / Hostname',
    value: dev => dev.hostname || dev.detected_device || dev.omnivista?.device_name || dev.name || '—',
  },
  {
    key: 'interface',
    label: 'Interfaz',
    value: dev => dev.interface || dev.vlan || '—',
  },
  {
    key: 'uptime',
    label: 'Tiempo Conectado',
    value: dev => dev.uptime_seconds != null ? formatUptime(dev.uptime_seconds) : (dev.uptime ? String(dev.uptime) : '—'),
  },
  {
    key: 'location',
    label: 'Ubicación',
    value: () => '',
  },
  {
    key: 'floor',
    label: 'Piso',
    value: () => '',
  },
];

export function buildSupportSheets({ computers = [], printers = [], includeComputers = true, includePrinters = true, columns = SUPPORT_EXPORT_COLUMNS } = {}) {
  const sheets = [];
  if (includeComputers) {
    sheets.push({
      name: 'Computadoras',
      columns,
      rows: computers,
    });
  }
  if (includePrinters) {
    sheets.push({
      name: 'Impresoras',
      columns,
      rows: printers,
    });
  }
  return sheets;
}

export function makeExcelWorkbook(sheets) {
  const sheetList = Array.isArray(sheets) ? sheets : (sheets && typeof sheets === 'object' ? [sheets] : []);
  const validSheets = sheetList.filter(s => s && (Array.isArray(s.rows) || Array.isArray(s.columns)));

  const worksheetsXml = (validSheets.length ? validSheets : [{ name: 'Datos', columns: SUPPORT_EXPORT_COLUMNS, rows: [] }]).map((sheet, index) => {
    const sheetName = escapeXml(sanitizeWorksheetName(sheet.name || `Hoja${index + 1}`));
    const columns = Array.isArray(sheet.columns) && sheet.columns.length ? sheet.columns : SUPPORT_EXPORT_COLUMNS;
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];

    const headerCells = columns.map(c => {
      const label = c.label != null ? String(c.label) : (c.key != null ? String(c.key) : '');
      return `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(label)}</Data></Cell>`;
    }).join('');

    const headerRow = `    <Row ss:AutoFitHeight="0">\n      ${headerCells}\n    </Row>`;

    const dataRows = rows.map(row => {
      const cells = columns.map(c => {
        const val = typeof c.value === 'function' ? c.value(row) : (row?.[c.key] ?? '');
        const strVal = val == null ? '' : String(val);
        return `<Cell><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>`;
      }).join('');
      return `    <Row ss:AutoFitHeight="0">\n      ${cells}\n    </Row>`;
    });

    const allRows = [headerRow, ...dataRows].join('\n');

    return `  <Worksheet ss:Name="${sheetName}">\n    <Table>\n${allRows}\n    </Table>\n  </Worksheet>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<?mso-application progid="Excel.Sheet"?>\n`
    + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n`
    + ` xmlns:o="urn:schemas-microsoft-com:office:office"\n`
    + ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n`
    + ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n`
    + ` xmlns:html="http://www.w3.org/TR/REC-html40">\n`
    + `  <Styles>\n`
    + `    <Style ss:ID="Default" ss:Name="Normal">\n`
    + `      <Alignment ss:Vertical="Bottom"/>\n`
    + `      <Borders/>\n`
    + `      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>\n`
    + `      <Interior/>\n`
    + `      <NumberFormat/>\n`
    + `      <Protection/>\n`
    + `    </Style>\n`
    + `    <Style ss:ID="Header">\n`
    + `      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>\n`
    + `      <Interior ss:Color="#1E293B" ss:Pattern="Solid"/>\n`
    + `      <Alignment ss:Vertical="Center" ss:Horizontal="Left"/>\n`
    + `    </Style>\n`
    + `  </Styles>\n`
    + `${worksheetsXml}\n`
    + `</Workbook>`;
}

export function selectRows(rows, query, filters = {}, sortKey = '', ascending = true) {
  const q = query.trim().toLocaleLowerCase(LOCALE);
  return rows.filter(row => Object.entries(filters).every(([key, value]) => !value || String(row[key] ?? '') === value))
    .filter(row => !q || Object.values(row).some(value => typeof value !== 'object' && String(value ?? '').toLocaleLowerCase(LOCALE).includes(q)))
    .sort((a, b) => {
      if (!sortKey) return 0;
      const left = a[sortKey], right = b[sortKey];
      const result = typeof left === 'number' && typeof right === 'number' ? left - right
        : String(left ?? '').localeCompare(String(right ?? ''), LOCALE, { numeric: true });
      return result * (ascending ? 1 : -1);
    });
}
export function paginate(rows, page, size = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(pages, Math.max(1, Number(page) || 1));
  return { rows: rows.slice((current - 1) * size, current * size), current, pages, total: rows.length };
}
export function inventoryFromIdfs(idfs) {
  return idfs.flatMap(idf => (idf.devices || []).map((device, index) => ({
    ...device, id: `${idf.id}:${index}`, idfId: idf.id, index, name: device.desc || 'Equipo sin descripción',
    category: device.type || 'Equipo de red', idf: idf.name, zone: idf.zone || 'Sin ubicación',
    status: device.status || 'unknown', brand: device.brandModel || [device.brand, device.model].filter(Boolean).join(' '),
  })));
}
export function reportsFromData(reports, idfs) {
  const records = new Map();
  for (const idf of idfs) {
    const stored = reports[idf.id];
    const incidents = [...(idf.incidents || []), ...(Array.isArray(stored) ? stored : stored?.incidents || [])];
    for (const [index, incident] of incidents.entries()) {
      const key = `${idf.id}:${incident.origin_key || incident.id || incident.record_key || `legacy-${index}`}`;
      records.set(key, { ...incident, key, idfId: idf.id, idf: idf.name, actor: incident.tech || incident.reporter || 'Sin responsable' });
    }
  }
  return [...records.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
export class ApiError extends Error {
  constructor(status, message) {
    super(message || (status === 401 ? 'La sesión venció. Vuelve a iniciar sesión para continuar.'
      : status === 403 ? 'No tienes permiso para consultar o modificar este recurso.'
        : status === 409 ? 'El registro cambió. Actualiza los datos antes de guardar.'
          : status === 429 ? 'Se alcanzó el límite de consultas. Espera un momento antes de reintentar.'
            : 'No se pudo completar la consulta. Revisa la conexión y vuelve a intentar.'));
    this.status = status;
  }
}
export function isLocalOrPrivateHost(hostname) {
  if (!hostname) return false;
  const host = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.lan')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    const [a, b] = parts.map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (/^(fc|fd|fe[89ab])/i.test(host)) return true;
  return false;
}

let csrfToken = '';
export function setCsrfToken(value) { csrfToken = value || ''; }
export async function request(path, { signal, body } = {}) {
  if (!path.startsWith('/api/') || new URL(path, location.origin).origin !== location.origin) throw new Error('Destino de solicitud no permitido.');
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && isLocalOrPrivateHost(location.hostname))) throw new ApiError(403, 'Abre el dashboard mediante HTTPS para proteger las credenciales y la sesión.');
  const response = await fetch(path, {
    signal: signal || AbortSignal.timeout(15000), credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : { Accept: 'application/json' },
    method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('sgrs-session-expired'));
    const local = path.startsWith('/api/admin/') || path.startsWith('/api/auth/') || path.startsWith('/api/inventory/') || path.startsWith('/api/reports');
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, local && response.status < 500 && typeof payload.error === 'string' ? payload.error : undefined);
  }
  const json = await response.json();
  if (json.success === false || json.error) throw new ApiError(502);
  return json;
}
