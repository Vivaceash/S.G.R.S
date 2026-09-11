import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, paginate, selectRows, inventoryFromIdfs, reportsFromData } from '../src/domain.mjs';

test('CSV neutraliza fórmulas incluso después de espacios y conserva comillas', () => {
  for (const text of ['=1+1', '  +SUM(A1)', '\t@formula', '-2+4', '\r=1']) assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('Área "Clínica"'), '"Área ""Clínica"""');
});
test('Filtrar restablece una página fuera de rango y el orden de IPs es numérico', () => {
  const rows = [{ ip: '10.0.0.10', status: 'online' }, { ip: '10.0.0.2', status: 'online' }, { ip: '10.0.0.1', status: 'offline' }];
  const filtered = selectRows(rows, '10.0', { status: 'online' }, 'ip');
  assert.deepEqual(filtered.map(r => r.ip), ['10.0.0.2', '10.0.0.10']);
  assert.equal(paginate(filtered, 72, 10).current, 1);
  assert.equal(paginate([], 3).pages, 1);
});
test('Inventario conserva IDF e índice originales para el contrato legacy', () => {
  const rows = inventoryFromIdfs([{ id: 'idf-2', name: 'IDF-02', devices: [{ desc: 'Switch', serial: 'SERIAL' }] }]);
  assert.equal(rows[0].idfId, 'idf-2'); assert.equal(rows[0].index, 0); assert.equal(rows[0].serial, 'SERIAL');
});
test('Bitácora fusiona formatos históricos sin duplicar incidentes de un mismo IDF', () => {
  const idfs = [{ id: 'idf-1', name: 'IDF-01', incidents: [{ id: 'same', title: 'Anterior' }] }, { id: 'idf-2', name: 'IDF-02' }];
  const reports = { 'idf-1': { incidents: [{ id: 'same', title: 'Actualizado' }] }, 'idf-2': [{ id: 'same', title: 'Otro gabinete' }] };
  const rows = reportsFromData(reports, idfs);
  assert.equal(rows.length, 2); assert.equal(rows.find(r => r.idfId === 'idf-1').title, 'Actualizado');
});
