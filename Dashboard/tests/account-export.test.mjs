import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { accountExportDate, accountExportStatus, accountExportDeviceCount } from '../src/account-export.mjs';
import { makeXlsxWorkbook } from '../src/excel.mjs';
import { selectRows } from '../src/domain.mjs';

test('account device sorting uses numeric counts in both directions and keeps filters', () => {
  const rows = [
    { username: 'twelve', department: 'A', devices: Array.from({ length: 12 }, (_, id) => ({ id })) },
    { username: 'two', department: 'A', devices: [{ id: 1 }, { id: 2 }] },
    { username: 'none', department: 'A' },
    { username: 'other', department: 'B', devices: [{ id: 1 }] },
  ];
  const sorted = ascending => selectRows(rows, '', { department: 'A' }, 'devices', ascending, accountExportDeviceCount).map(row => row.username);
  assert.deepEqual(sorted(true), ['none', 'two', 'twelve']);
  assert.deepEqual(sorted(false), ['twelve', 'two', 'none']);
  assert.deepEqual(rows.map(row => row.username), ['twelve', 'two', 'none', 'other']);
});

test('account export formats timestamps, session status and device totals in XLSX', async () => {
  const rows = [
    { omnivistaEffectiveDate: Date.parse('2026-10-29T18:00:00Z'), status: 1, devices: [{ deviceMac: '00:11:22:33:44:55' }, { deviceMac: '00:11:22:33:44:66' }] },
    { status: '0', devices: [] },
  ];
  const columns = [
    { label: 'Fecha de alta', value: accountExportDate },
    { label: 'Estado', value: accountExportStatus },
    { label: 'Dispositivos', value: accountExportDeviceCount },
  ];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await makeXlsxWorkbook([{ name: 'Cuentas', columns, rows }]));
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['29/10/2026', 'Sesión activa', 2]);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ['Sin registro', 'Sin sesión activa', 0]);
});

test('account export handles date fallbacks, seconds and missing data', () => {
  const millis = Date.parse('2026-10-29T18:00:00Z');
  for (const raw of [millis, String(millis), millis / 1000, '2026-10-29T18:00:00Z']) {
    assert.equal(accountExportDate({ dateOfEffective: raw }), '29/10/2026');
  }
  assert.equal(accountExportDate({ customConcession: true, dateOfEffective: millis }), 'Sin registro');
  for (const raw of [null, '', 0, 'invalid']) assert.equal(accountExportDate({ omnivistaEffectiveDate: raw }), 'Sin registro');
  assert.equal(accountExportStatus({ status: '1' }), 'Sesión activa');
  assert.equal(accountExportStatus({ status: 0 }), 'Sin sesión activa');
  assert.equal(accountExportStatus({}), 'Sin verificar');
  assert.equal(accountExportDeviceCount({}), 0);
  assert.equal(accountExportDeviceCount({ devices: [{ deviceMac: '00:11:22:33:44:55' }, { deviceMac: '00:11:22:33:44:55' }] }), 1);
});
