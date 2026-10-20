import { normalizeText, isMeztliSegment, deviceInSegment } from './domain.mjs';

/**
 * Prefijo institucional habitual para equipos de cómputo y estaciones de trabajo.
 */
export const INSTITUTIONAL_HOSTNAME_PATTERN = /(?:^|\b)04820300/i;

/**
 * Evalúa si un dispositivo cuenta con un nombre de host institucional (e.g. 04820300-56MQ62)
 * registrado en Fortinet (DHCP / lease / operational).
 */
export function isInstitutionalDevice(device) {
  if (!device || typeof device !== 'object') return false;
  const candidates = [
    device.hostname,
    device.name,
    device.detected_device,
    device.serial,
    device.raw?.host_name,
    device.raw?.hostname,
    device.raw?.name,
    device.raw?.serial,
  ];
  return candidates.some(val => val && INSTITUTIONAL_HOSTNAME_PATTERN.test(String(val).trim()));
}

/**
 * Evalúa si un dispositivo está conectado a través de una red inalámbrica / WiFi:
 * - Tiene AP asignado en OmniVista (ap_name o ssid)
 * - Pertenece al segmento Meztli (VLAN 94 / SSID institucional)
 * - Su interfaz, vlan o notas indican meztli, wlan o wifi
 */
export function isWifiDevice(device, segments = []) {
  if (!device || typeof device !== 'object') return false;

  // 1. Cotejo directo en OmniVista con AP o SSID
  if (device.omnivista?.ap_name || device.omnivista?.ssid) return true;

  // 2. Interfaz, VLAN o SSID en datos de red
  const text = normalizeText([
    device.interface,
    device.vlan,
    device.ssid,
    device.network,
    device.omnivista?.profile,
    device.raw?.interface,
    device.raw?.vlan,
  ].filter(Boolean).join(' '));

  if (text.includes('meztli') || text.includes('wifi') || text.includes('wlan') || text.includes('wireless') || /\b94\b/.test(String(device.vlan || ''))) {
    return true;
  }

  // 3. Pertenencia a un segmento WiFi / Meztli reconocido
  if (Array.isArray(segments) && segments.length) {
    const meztliSegment = segments.find(s => isMeztliSegment(s) || normalizeText(s.name || s.interface || '').includes('meztli') || String(s.vlan || '') === '94');
    if (meztliSegment && deviceInSegment(device, meztliSegment)) {
      return true;
    }
  }

  return false;
}

/**
 * Obtiene y estructura los equipos institucionales conectados por WiFi,
 * extrayendo tanto la información de Fortinet (hostname, IP, MAC) como de OmniVista (nombre amigable, AP, ubicación).
 */
export function getInstitutionalWifiDevices(devices = [], segments = [], wifiOnly = true) {
  if (!Array.isArray(devices)) return [];

  return devices.filter(dev => {
    if (dev.status !== 'online') return false;
    if (!isInstitutionalDevice(dev)) return false;
    if (wifiOnly && !isWifiDevice(dev, segments)) return false;
    return true;
  });
}

/**
 * Catálogo de widgets y columnas disponibles para el módulo de Soporte.
 */
export const SUPPORT_WIDGET_CATALOG = [
  {
    id: 'networks',
    title: 'Listado de redes y estados',
    module: 'Soporte',
    category: 'Redes',
    description: 'Monitoreo de saturación, gateways, VLANs y balance de direcciones IP libres vs ocupadas.',
    iconName: 'Network',
    tone: 'brand',
  },
  {
    id: 'computers',
    title: 'Computadoras conectadas',
    module: 'Soporte',
    category: 'Dispositivos',
    description: 'Computadoras y estaciones de trabajo en línea, con ordenamiento por uptime y detalle técnico.',
    iconName: 'Monitor',
    tone: 'success',
  },
  {
    id: 'printers',
    title: 'Impresoras conectadas',
    module: 'Soporte',
    category: 'Dispositivos',
    description: 'Impresoras activas en red de soporte, modelos y cotejo de ubicación institucional.',
    iconName: 'Printer',
    tone: 'info',
  },
  {
    id: 'institutional-wifi',
    title: 'Institucionales por WIFI',
    module: 'Soporte',
    category: 'WiFi Institucional',
    description: 'Equipos institucionales (hostname 04820300) detectados en FortiGate conectados vía WiFi, cotejados con OmniVista para nombre, AP y ubicación.',
    iconName: 'Wifi',
    tone: 'purple',
  },
];

/**
 * Diseño por defecto de columnas de soporte (las 3 columnas anteriores del módulo de soporte).
 */
export const DEFAULT_SUPPORT_LAYOUT = [
  'networks',
  'computers',
  'printers',
];

/**
 * Sanitiza y valida la configuración de layout guardada en localStorage.
 */
export function sanitizeSupportLayout(layout, catalog = SUPPORT_WIDGET_CATALOG) {
  if (!Array.isArray(layout)) return [...DEFAULT_SUPPORT_LAYOUT];
  const allowed = new Set(catalog.map(w => w.id));
  const seen = new Set();
  const valid = [];

  for (const item of layout) {
    const id = typeof item === 'string' ? item : item?.id;
    if (id && allowed.has(id) && !seen.has(id)) {
      seen.add(id);
      valid.push(id);
    }
  }

  return valid.length ? valid : [...DEFAULT_SUPPORT_LAYOUT];
}
