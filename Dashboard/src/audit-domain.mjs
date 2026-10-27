import { AVAILABLE_PAGES, SUBMODULES, capabilityLabel, dateTime, roleLabel } from './domain.mjs';

const fieldNames = {
  username: 'usuario de acceso', name: 'nombre', role: 'rol', active: 'estado de la cuenta',
  keep_session: 'sesión persistente', is_hidden: 'visibilidad', allowed_pages: 'módulos permitidos',
  allowed_submodules: 'pestañas permitidas', capabilities: 'permisos de acciones',
};
const setFields = new Set(['allowed_pages', 'allowed_submodules', 'capabilities']);
const pageNames = Object.fromEntries(AVAILABLE_PAGES.map(page => [page.id, page.label]));
const tabNames = Object.fromEntries(Object.entries(SUBMODULES).flatMap(([page, tabs]) => tabs.map(tab => [`${page}:${tab.id}`, `${pageNames[page] || page} · ${tab.label}`])));

export function auditTimestamp(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const milliseconds = Math.abs(number) < 1e11 ? number * 1000 : number;
    return Number.isNaN(new Date(milliseconds).getTime()) ? null : milliseconds;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function auditDate(value) {
  const timestamp = auditTimestamp(value);
  return timestamp === null ? 'Fecha no determinada' : dateTime(new Date(timestamp));
}

export function auditDetails(details) {
  if (details && typeof details === 'object' && !Array.isArray(details)) return details;
  if (typeof details !== 'string') return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function auditChangeRows(details) {
  const parsed = auditDetails(details);
  if (!parsed?.before || !parsed?.after) return [];
  return Object.keys(fieldNames).filter(key => {
    const normalize = value => JSON.stringify(setFields.has(key) && Array.isArray(value) ? [...value].sort() : value);
    return normalize(parsed.before[key]) !== normalize(parsed.after[key]);
  }).map(key => ({ key, label: fieldNames[key], before: parsed.before[key], after: parsed.after[key] }));
}

export function auditValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Sin información';
  if (Array.isArray(value)) {
    return value.map(item => key === 'capabilities' ? capabilityLabel(item) : key === 'allowed_pages' ? pageNames[item] || item : key === 'allowed_submodules' ? tabNames[item] || item : String(item)).join(' · ') || 'Ninguno';
  }
  if (key === 'role') return roleLabel(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return typeof value === 'object' ? 'Datos estructurados' : String(value);
}

export function auditSummary(action, details, fallback) {
  const parsed = auditDetails(details);
  if (!parsed) {
    if (typeof details === 'string' && details.trim() && !/^[\[{]/.test(details.trim())) return details;
    return fallback;
  }
  if (parsed.before && parsed.after) {
    const changes = auditChangeRows(parsed);
    return changes.length ? `Cambios en ${changes.map(change => change.label).join(', ')}.` : 'Se guardó la cuenta sin cambios en sus datos o permisos.';
  }
  if (Array.isArray(parsed.capabilities)) return `${action.endsWith('revoked') ? 'Se revocaron' : 'Se concedieron'} ${parsed.capabilities.length} permisos de acciones.`;
  if (typeof parsed.reason === 'string') return parsed.reason;
  if (typeof parsed.description === 'string') return parsed.description;
  if (typeof parsed.hidden === 'boolean') return `Cuenta ${parsed.hidden ? 'oculta' : 'visible'}${parsed.category ? ` · Clasificación: ${parsed.category}` : ''}${parsed.comment_updated ? ' · Comentario actualizado' : ''}.`;
  if (parsed.role) return `Rol: ${roleLabel(parsed.role)}.`;
  return fallback;
}

export function auditTargetLabel(event, idfs = []) {
  if (event.target_label && event.target_label !== event.target) return event.target_label;
  const target = String(event.target || '');
  const [idfId] = target.split(':');
  if (/^idf-[\w-]+$/i.test(idfId)) {
    return `${idfs.find(idf => idf.id === idfId)?.name || idfId.toUpperCase()} · Registro IDF`;
  }
  return event.target_label || target || '—';
}
