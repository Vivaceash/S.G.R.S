import { userDevices } from './altas-analytics.mjs';

export function accountExportDate(account) {
  const raw = account.omnivistaEffectiveDate ?? (account.customConcession ? null : account.dateOfEffective);
  if (raw == null || raw === '') return 'Sin registro';
  const numeric = Number(raw);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : raw);
  if (!Number.isFinite(date.getTime()) || (Number.isFinite(numeric) && numeric <= 0)) return 'Sin registro';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' }).format(date);
}

export function accountExportStatus(account) {
  const status = String(account.status ?? '').toLowerCase();
  if (['1', 'online', 'active', 'normal'].includes(status)) return 'Sesión activa';
  if (['0', 'offline', 'inactive'].includes(status)) return 'Sin sesión activa';
  return 'Sin verificar';
}

export const accountExportDeviceCount = account => userDevices(account).length;
