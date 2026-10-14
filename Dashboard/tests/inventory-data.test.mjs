import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventoryCatalog } from '../src/inventory-data.mjs';

const catalog = () => ({ revision: 'rev-1', cabinets: [{ id: 'idf-1', name: 'IDF 1' }], assets: [
  { id: 'cam-1', dataset: 'cctv', name: 'Cámara actualizada', version: 'rev-1:0' },
  { id: 'old-1', dataset: 'cctv_original', name: 'Cámara original', version: 'rev-1:0' },
] });

test('normaliza campos opcionales preservando identidad, revisión y catálogos CCTV', () => {
  const input = catalog();
  const result = normalizeInventoryCatalog(input);
  assert.deepEqual(result.assets.map(a => a.dataset), ['cctv', 'cctv_original']);
  assert.equal(result.revision, 'rev-1');
  assert.equal(result.assets[0].version, 'rev-1:0');
  assert.equal(result.assets[0].decommissioned, false);
  assert.deepEqual(result.observations, []);
  assert.deepEqual(result.assets[0].issues, []);
  assert.equal(input.assets[0].issues, undefined, 'no modifica el objeto recibido');
});

test('rechaza respuestas incompletas, identificadores duplicados y campos que romperían la ficha', () => {
  const malformed = [null, [], {}, { ...catalog(), assets: null }, { ...catalog(), cabinets: null },
    { ...catalog(), revision: '' }, { ...catalog(), assets: [null] },
    { ...catalog(), assets: [catalog().assets[0], catalog().assets[0]] },
    { ...catalog(), assets: [{ ...catalog().assets[0], decommissioned: 'false' }] },
    { ...catalog(), assets: [{ ...catalog().assets[0], issues: 'Error' }] },
    { ...catalog(), assets: [{ ...catalog().assets[0], location: {} }] },
    { ...catalog(), observations: [{ text: {} }] }];
  for (const input of malformed) assert.throws(() => normalizeInventoryCatalog(input), /formato no válido/);
});

test('acepta un catálogo vacío confirmado y conserva bajas reales', () => {
  assert.deepEqual(normalizeInventoryCatalog({ revision: 'rev-1', cabinets: [], assets: [] }).assets, []);
  const input = catalog(); input.assets[0].decommissioned = true;
  assert.equal(normalizeInventoryCatalog(input).assets[0].decommissioned, true);
});
