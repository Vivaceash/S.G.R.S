import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeXlsxWorkbook } from '../src/excel.mjs';
import { buildSegmentDeviceSheets } from '../src/domain.mjs';
import { spreadsheetValue, makeCsv } from '../src/domain.mjs';

test('all spreadsheet exports normalize nested data, dates, statuses and preserve identifiers', async () => {
  const row = { devices: [{ mac: '00:11:22:33:44:55' }], status: 'online', created_at: '1793296800000', metadata: { vlan: 94, reserved: true }, list: '[{"name":"Equipo"}]', serial: '001234', count: 0, enabled: false, activity: '2026-10-29T18:00:00Z' };
  const columns = Object.keys(row).map(key => ({ key, label: key }));
  const values = columns.map(column => spreadsheetValue(column, row));
  assert.equal(values[0], 1);
  assert.equal(values[1], 'En servicio');
  assert.match(values[2], /29\/10\/2026/);
  assert.equal(values[3], 'vlan: 94; reserved: Sí');
  assert.equal(values[4], 'name: Equipo');
  assert.equal(values[5], '001234');
  assert.equal(values[6], 0);
  assert.equal(values[7], 'No');
  assert.match(values[8], /29\/10\/2026/);
  const csv = makeCsv(columns, [row]);
  assert.ok(!csv.includes('[object Object]'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await makeXlsxWorkbook([{ name: 'Prueba', columns, rows: [row] }]));
  assert.deepEqual(workbook.worksheets[0].getRow(2).values.slice(1), values);
  assert.equal(workbook.worksheets[0].views[0].state, 'frozen');
  assert.ok(workbook.worksheets[0].autoFilter);
});

test('XLSX preserves segment devices, filtered sheets, Unicode and literal formulas', async () => {
  const devices = [
    { ip: '10.0.0.1', mac: '00:01:02:03:04:05', hostname: 'Equipo médico', type: 'computer' },
    { ip: '10.0.0.2', hostname: '=1+1', type: 'computer' },
  ];
  const sheets = buildSegmentDeviceSheets({ segment: { name: 'Clínica' }, allDevices: devices, filteredDevices: [devices[1]] });
  const bytes = await makeXlsxWorkbook(sheets);
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.worksheets[0].rowCount, 2);
  assert.equal(workbook.worksheets[1].rowCount, 3);
  const values = workbook.worksheets[1].getSheetValues().flat(2);
  for (const value of ['10.0.0.1', '00:01:02:03:04:05', 'Equipo médico', '=1+1']) assert.ok(values.includes(value), value);
  workbook.worksheets[1].eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
});

test('XLSX handles empty exports and duplicate sanitized worksheet names', async () => {
  for (const sheets of [[], [{ name: 'A/B', rows: [] }, { name: 'AB', rows: [] }]]) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await makeXlsxWorkbook(sheets));
    assert.equal(workbook.worksheets.length, sheets.length || 1);
    assert.ok(workbook.worksheets.every(sheet => sheet.rowCount === 1));
  }
});
