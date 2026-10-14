const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('El catálogo de Inventarios está incompleto o tiene un formato no válido. Vuelve a intentar.'); };

export function normalizeInventoryCatalog(value) {
  if (!object(value) || !Array.isArray(value.assets) || !Array.isArray(value.cabinets)
      || typeof value.revision !== 'string' || !value.revision.trim()) invalid();
  const ids = new Set();
  const assets = value.assets.map(asset => {
    if (!object(asset) || typeof asset.id !== 'string' || !asset.id.trim()
        || ids.has(asset.id) || !['idf', 'ap', 'cctv', 'cctv_original'].includes(asset.dataset)) invalid();
    ids.add(asset.id);
    for (const field of ['name', 'model', 'serial', 'mac', 'documented_ip', 'idf_id', 'location', 'destination', 'version', 'notes', 'rack', 'ports', 'number']) {
      if (field in asset && asset[field] !== null && typeof asset[field] !== 'string') invalid();
    }
    for (const field of ['decommissioned', 'relocated']) if (field in asset && typeof asset[field] !== 'boolean') invalid();
    if ('issues' in asset && (!Array.isArray(asset.issues) || asset.issues.some(issue => typeof issue !== 'string'))) invalid();
    if ('source' in asset && !object(asset.source)) invalid();
    return { ...asset, name: asset.name || '', issues: asset.issues || [], source: asset.source || {},
      decommissioned: asset.decommissioned ?? false, relocated: asset.relocated ?? false };
  });
  const cabinets = value.cabinets.map(cabinet => {
    if (!object(cabinet) || typeof cabinet.id !== 'string' || typeof cabinet.name !== 'string') invalid();
    return cabinet;
  });
  for (const field of ['observations', 'sources']) if (field in value && !Array.isArray(value[field])) invalid();
  const observations = value.observations || [];
  if (observations.some(observation => !object(observation) || ('text' in observation && typeof observation.text !== 'string'))) invalid();
  if ('structure' in value && !object(value.structure)) invalid();
  return { ...value, assets, cabinets, observations, sources: value.sources || [], structure: value.structure || {} };
}
