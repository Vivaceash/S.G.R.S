import io
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from dashboard_spreadsheets import xlsx_bytes


def test_xlsx_has_cell_addresses_literal_text_and_readable_objects():
    payload = xlsx_bytes(['Cuenta', 'Detalle'], [('Cuentas', [['=1+1', {'mac': '00:11', 'reserved': True}], ['00123', None]])])
    with ZipFile(io.BytesIO(payload)) as archive:
        for name in archive.namelist():
            ET.fromstring(archive.read(name))
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        cells = sheet.findall('.//s:c', ns)
        assert [cell.get('r') for cell in cells] == ['A1', 'B1', 'A2', 'B2', 'A3', 'B3']
        assert cells[2].find('s:is/s:t', ns).text == '=1+1'
        assert cells[3].find('s:is/s:t', ns).text == 'mac: 00:11; reserved: Sí'
        assert cells[4].find('s:is/s:t', ns).text == '00123'
        assert sheet.find('.//s:f', ns) is None
