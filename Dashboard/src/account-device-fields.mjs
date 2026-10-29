import { dateTime } from './domain.mjs';

const clean = value => /^(unknown|desconocido|n\/a|null|undefined|—|-)?$/i.test(String(value ?? '').trim()) ? '' : String(value).trim();
const normalized = value => clean(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const networkKey = value => normalized(value).replace(/^_*(?:ssid[-_ ]*)?/, '').replace(/[-_ ]/g, '');

export function deviceDate(value) {
  if (value == null || value === '' || !clean(value)) return '';
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
  return Number.isFinite(date.getTime()) && (!Number.isFinite(numeric) || numeric > 0) ? dateTime(date) : '';
}

export function accountDeviceFields(device) {
  const forti = device.forti || {};
  const fields = [];
  const add = (label, value, icon, mono) => { if (clean(value)) fields.push([label, value, icon, mono]); };
  const category = [...new Set([device.deviceCategory, device.deviceFamily].map(clean).filter(Boolean))];
  const network = clean(device.lastAccessDeviceSSID) || clean(device.accessRoleProfile);
  const os = clean(device.deviceOS) || clean(forti.os);
  add('MAC', clean(device.deviceMac), 'network', true);
  add('Equipo OmniVista', clean(device.lastAccessDeviceName), 'package');
  add('Categoría / familia', category.join(' · '), 'device');
  add('Sistema operativo', os, 'os');
  add('Red', network || clean(forti.interface), 'wifi');
  add('Ubicación', clean(device.lastAccessLocation), 'location');
  add('Última autenticación', deviceDate(device.lastAuthenticationTime), 'clock');
  add('Descripción', clean(device.description), 'file');
  const name = clean(forti.hostname) || clean(forti.name);
  const identities = [device.deviceName, device.deviceMac, device.lastAccessDeviceName, forti.ip].map(normalized);
  if (name && !identities.includes(normalized(name))) add('Nombre FortiGate', name, 'shield');
  const hardware = [...new Set([forti.vendor, forti.model].map(clean).filter(Boolean))]
    .filter(value => !category.some(item => normalized(item) === normalized(value)));
  add('Fabricante / modelo FortiGate', hardware.join(' · '), 'package');
  if (clean(forti.os) && normalized(forti.os) !== normalized(os)) add('Sistema operativo FortiGate', clean(forti.os), 'os');
  add('Dirección IP', clean(forti.ip), 'network', true);
  if (clean(forti.type) && !category.some(item => normalized(item) === normalized(forti.type))) add('Tipo FortiGate', clean(forti.type), 'device');
  if (network && clean(forti.interface) && networkKey(network) !== networkKey(forti.interface)) add('Interfaz FortiGate', clean(forti.interface), 'wifi');
  add('Última detección FortiGate', deviceDate(forti.last_seen), 'clock');
  return fields;
}
