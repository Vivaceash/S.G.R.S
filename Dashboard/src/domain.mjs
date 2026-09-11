export const LOCALE = 'es-MX';
export const TIME_ZONE = 'America/Mexico_City';
export const number = value => value == null ? '—' : new Intl.NumberFormat(LOCALE).format(value);
export const dateTime = value => {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE,
  }).format(date);
};
export const statusNames = {
  online: 'En servicio', offline: 'Fuera de línea', normal: 'Operativo', warning: 'Con alerta',
  critical: 'Crítico', available: 'Disponible', occupied: 'Asignada', reserved: 'Reservada',
  approved: 'Aprobado', pending: 'Pendiente', review: 'En revisión', rejected: 'Rechazado',
  open: 'Abierto', resolved: 'Resuelto', in_progress: 'En atención', low: 'Stock bajo', unknown: 'Sin verificar',
};
export const statusTone = status => ['online', 'normal', 'available', 'approved', 'resolved'].includes(status) ? 'success'
  : ['warning', 'pending', 'low', 'in_progress'].includes(status) ? 'warning'
    : ['critical', 'rejected', 'open'].includes(status) ? 'danger' : status === 'review' ? 'info' : 'neutral';

// Every exported value is quoted; spreadsheet formulas and leading controls are neutralized.
export function csvCell(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function makeCsv(columns, rows) {
  return '\uFEFF' + [columns.map(c => csvCell(c.label)).join(','), ...rows.map(row => columns.map(c => csvCell(c.value ? c.value(row) : row[c.key])).join(','))].join('\r\n');
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
    for (const incident of incidents) records.set(`${idf.id}:${incident.id}`, {
      ...incident, key: `${idf.id}:${incident.id}`, idfId: idf.id, idf: idf.name, actor: incident.tech || 'Sin responsable',
    });
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
let csrfToken = '';
export function setCsrfToken(value) { csrfToken = value || ''; }
export async function request(path, { signal, body } = {}) {
  const response = await fetch(path, {
    signal: signal || AbortSignal.timeout(15000), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : { Accept: 'application/json' },
    method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('sgrs-session-expired'));
    const local = path.startsWith('/api/admin/') || path.startsWith('/api/auth/') || path === '/api/reports';
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, local && response.status < 500 && typeof payload.error === 'string' ? payload.error : undefined);
  }
  const json = await response.json();
  if (json.success === false || json.error) throw new ApiError(502);
  return json;
}
