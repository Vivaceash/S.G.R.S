import { defaultSubmodules } from './domain.mjs';

// The page switch grants its read prerequisites; actions stay explicit.
export const MODULE_PERMISSIONS = {
  resumen: { read: ['dashboard.read'], actions: [] },
  dispositivos: { read: ['dashboard.read', 'inventory.read'], actions: ['inventory.export', 'traffic.read'] },
  disponibilidad: { read: ['dashboard.read', 'inventory.read'], actions: ['inventory.export'] },
  'gestion-meztli': { read: ['dashboard.read', 'inventory.read'], actions: ['inventory.export'] },
  bitacora: { read: ['activity.read'], actions: [] },
  idf: { read: ['idf.read'], actions: ['inventory.write', 'inventory.export', 'idf.visits.write'] },
  'bitacora-idf': { read: ['activity.read'], actions: [] },
  aps: { read: ['inventory.read'], actions: ['inventory.write', 'inventory.export'] },
  cctv: { read: ['inventory.read'], actions: ['inventory.write', 'inventory.export'] },
  altas: { read: ['dashboard.read'], actions: ['inventory.write'] },
  soporte: { read: ['dashboard.read'], actions: ['inventory.write', 'inventory.export', 'idf.visits.write'] },
  usuarios: { read: ['users.read'], actions: ['users.create', 'users.edit', 'users.delete'] },
  conexiones: { read: ['integrations.manage'], actions: [] },
};

export const SUBMODULE_READ_PERMISSIONS = {
  'soporte:live': ['dashboard.read'], 'soporte:log': ['activity.read', 'inventory.read'], 'soporte:inventory': ['inventory.read'],
  'idf:activity': ['activity.read'], 'idf:inventory': ['inventory.read'], 'idf:qr': ['idf.read'],
};
export const readCapabilities = (page, submodules) => [...new Set([
  ...(MODULE_PERMISSIONS[page]?.read || []),
  ...submodules.filter(key => key.startsWith(`${page}:`)).flatMap(key => SUBMODULE_READ_PERMISSIONS[key] || []),
])];

export const ROLE_CAPABILITIES = {
  soporte: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read'],
  viewer: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read'],
  admin: ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'inventory.write', 'inventory.export', 'idf.visits.write', 'users.read', 'users.create', 'users.edit', 'users.delete'],
  'super-admin': [...new Set(Object.values(MODULE_PERMISSIONS).flatMap(module => [...module.read, ...module.actions]))],
};

export function selectModule(access, page, enabled, canChangeCapability, canChangeSubmodule) {
  const definition = MODULE_PERMISSIONS[page];
  if (!definition) return access;
  if (enabled && definition.read.some(cap => !access.capabilities.includes(cap) && !canChangeCapability(cap))) return access;
  const pages = enabled ? [...new Set([...access.pages, page])] : access.pages.filter(id => id !== page);
  const submodules = enabled
    ? [...new Set([...access.submodules, ...defaultSubmodules([page]).filter(canChangeSubmodule)
      .filter(key => (SUBMODULE_READ_PERMISSIONS[key] || []).every(cap => access.capabilities.includes(cap) || canChangeCapability(cap)))])]
    : access.submodules.filter(key => !key.startsWith(`${page}:`));
  if (enabled && defaultSubmodules([page]).length && !submodules.some(key => key.startsWith(`${page}:`))) return access;
  const capabilities = enabled ? [...new Set([...access.capabilities, ...readCapabilities(page, submodules)])]
    : access.capabilities.filter(cap => !canChangeCapability(cap)
      || ![...readCapabilities(page, access.submodules), ...definition.actions].includes(cap)
      || pages.some(id => [...readCapabilities(id, submodules), ...(MODULE_PERMISSIONS[id]?.actions || [])].includes(cap)));
  return { pages, submodules, capabilities };
}

export function selectAction(access, page, capability, canChangeCapability, canChangeSubmodule) {
  if (!canChangeCapability(capability)) return access;
  if (access.pages.includes(page) && access.capabilities.includes(capability)) {
    return { ...access, capabilities: access.capabilities.filter(cap => cap !== capability) };
  }
  const next = selectModule(access, page, true, canChangeCapability, canChangeSubmodule);
  if (!next.pages.includes(page)) return access;
  return { ...next, capabilities: [...new Set([...next.capabilities, capability])] };
}
