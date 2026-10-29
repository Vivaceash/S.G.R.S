"""Small, dependency-free XLSX writer for device exports."""
import io
import re
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED


def scalar(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'Sí' if value else 'No'
    if isinstance(value, dict):
        return '; '.join(f'{key}: {scalar(item)}' for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return '; '.join(scalar(item) for item in value)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value))
    return text


def xlsx_bytes(columns, sheets):
    def address(column, row):
        letters = ''
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        return f'{letters}{row}'

    output = io.BytesIO()
    namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    package = 'http://schemas.openxmlformats.org/package/2006/relationships'
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        overrides = []
        names = []
        links = []
        for index, (name, rows) in enumerate(sheets, 1):
            names.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
            links.append(f'<Relationship Id="rId{index}" Type="{relationships}/worksheet" Target="worksheets/sheet{index}.xml"/>')
            overrides.append(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
            sheet_rows = []
            for number, row in enumerate([columns, *rows], 1):
                cells = ''.join(f'<c r="{address(column, number)}" t="inlineStr"><is><t xml:space="preserve">{escape(scalar(value))}</t></is></c>' for column, value in enumerate(row, 1))
                sheet_rows.append(f'<row r="{number}">{cells}</row>')
            widths = ''.join(f'<col min="{i}" max="{i}" width="{min(60, max(18, len(label) + 2))}" customWidth="1"/>' for i, label in enumerate(columns, 1))
            archive.writestr(f'xl/worksheets/sheet{index}.xml', f'<worksheet xmlns="{namespace}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols>{widths}</cols><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>')
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{namespace}" xmlns:r="{relationships}"><sheets>{"".join(names)}</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="{package}">{"".join(links)}</Relationships>')
        archive.writestr('_rels/.rels', f'<Relationships xmlns="{package}"><Relationship Id="rId1" Type="{relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(overrides) + '</Types>')
    return output.getvalue()
