import { sanitizeWorksheetName, SUPPORT_EXPORT_COLUMNS, spreadsheetValue } from './domain.mjs';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function makeXlsxWorkbook(sheets) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const list = Array.isArray(sheets) ? sheets : [sheets];
  const valid = list.filter(sheet => sheet && (Array.isArray(sheet.rows) || Array.isArray(sheet.columns)));
  for (const [index, sheet] of (valid.length ? valid : [{ name: 'Datos' }]).entries()) {
    const base = sanitizeWorksheetName(sheet.name || `Hoja${index + 1}`).replace(/^'+|'+$/g, '') || 'Hoja';
    let name = base;
    let suffix = 1;
    while (workbook.worksheets.some(ws => ws.name.toLowerCase() === name.toLowerCase())) {
      const tail = ` (${++suffix})`;
      name = base.slice(0, 31 - tail.length) + tail;
    }
    const worksheet = workbook.addWorksheet(name);
    const columns = sheet.columns?.length ? sheet.columns : SUPPORT_EXPORT_COLUMNS;
    worksheet.addRow(columns.map(column => String(column.label ?? column.key ?? '')));
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    for (const row of sheet.rows || []) {
      // Explicit strings preserve identifiers and never execute formulas.
      worksheet.addRow(columns.map(column => spreadsheetValue(column, row)));
    }
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: worksheet.rowCount, column: columns.length } };
    worksheet.columns.forEach(column => {
      let width = 12;
      column.eachCell(cell => { width = Math.max(width, Math.min(60, String(cell.value ?? '').length + 2)); });
      column.width = width;
      column.alignment = { vertical: 'top', wrapText: true };
    });
  }
  return workbook.xlsx.writeBuffer();
}
