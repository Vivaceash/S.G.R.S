"""Extract the audited physical inventory. Never imports credentials or executes macros.

Uses only the standard library for DOCX/XLSX. Optional encrypted structure summaries
require msoffcrypto-tool at import time, not in the dashboard runtime.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import getpass
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
W = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
X = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def clean(value):
    text = ' '.join(str(value or '').split())
    return '' if text.upper() in ('N/A', 'S/N', '—', '-') else text


def tables(path):
    with zipfile.ZipFile(path) as package:
        root = ET.fromstring(package.read('word/document.xml'))
    return [[[clean(' '.join(t.text or '' for t in cell.findall('.//w:t', W)))
              for cell in row.findall('w:tc', W)] for row in table.findall('w:tr', W)]
            for table in root.findall('w:body/w:tbl', W)]


def sheets(source):
    with zipfile.ZipFile(source) as package:
        strings = []
        if 'xl/sharedStrings.xml' in package.namelist():
            strings = [''.join(t.text or '' for t in item.findall('.//x:t', X))
                       for item in ET.fromstring(package.read('xl/sharedStrings.xml'))]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in
                ET.fromstring(package.read('xl/_rels/workbook.xml.rels'))}
        output = {}
        for sheet in ET.fromstring(package.read('xl/workbook.xml')).findall('x:sheets/x:sheet', X):
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(package.read(target)).findall('x:sheetData/x:row', X):
                values = {'row': int(row.attrib['r'])}
                for cell in row.findall('x:c', X):
                    value = cell.find('x:v', X)
                    value = value.text if value is not None else ''
                    kind = cell.attrib.get('t')
                    if kind == 's' and value:
                        value = strings[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.findall('.//x:t', X))
                    elif kind == 'b':
                        value = value == '1'
                    values[re.sub(r'\d', '', cell.attrib['r'])] = value if isinstance(value, bool) else clean(value)
                rows.append(values)
            output[sheet.attrib['name']] = rows
        return output


def section_id(value):
    if 'M.D.F' in value.upper() or value.upper() == 'MDF':
        return 'mdf'
    match = re.search(r'(?:No\.-|IDF[- ]?)(\d+)', value, re.I)
    return f'idf-{int(match[1])}' if match else ''


def extract(directory, structure=False):
    directory = Path(directory)
    files = ['CheckList completo IDFs.docx', 'Formato_de_AP[1].docx',
             'Actualización CCTV.xlsx', 'CheckList CCTV.xlsx']
    sources = {name: {'file': name, 'sha256': hashlib.sha256((directory / name).read_bytes()).hexdigest()}
               for name in files}
    assets, cabinets, observations = [], [], []
    occurrence = Counter()

    def provenance(file, row, **where):
        return {**sources[file], **where, 'row': row}

    def add(dataset, source, **fields):
        identity = '|'.join(str(fields.get(k, '')) for k in ('idf_id', 'rack', 'serial', 'mac', 'name', 'model', 'number'))
        occurrence[(dataset, identity)] += 1
        stable = f'{dataset}|{identity}|{occurrence[(dataset, identity)]}'
        assets.append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, stable)), 'dataset': dataset,
                       'source': source, 'issues': [], **fields})

    file = files[0]
    doc = tables(directory / file)
    for table_index, table in enumerate(doc[:-1], 1):
        label = table[0][0]
        idf_id = section_id(label)
        if not idf_id or len(table[1]) != 6:
            raise ValueError(f'Tabla IDF no reconocida: {table_index}')
        cabinets.append({'id': idf_id, 'name': label.replace('-', ' '), 'source': provenance(file, 1, table=table_index)})
        rack = ''
        for row_index, row in enumerate(table[2:], 3):
            if len(row) != 6:
                raise ValueError(f'Fila IDF no reconocida: {table_index}/{row_index}')
            name, brand, serial, model, mac, ports = row
            container = bool(re.match(r'rack\s*\d+', name, re.I))
            if container:
                rack = name
            add('idf', provenance(file, row_index, table=table_index), idf_id=idf_id,
                name=name, brand=brand, serial=serial, model=model, mac=mac, ports=ports,
                rack=rack, kind='rack' if container else 'equipment', location='', documented_ip='')
    for column in range(2):
        idf_id = ''
        for index, row in enumerate(doc[-1], 1):
            text = row[column] if column < len(row) else ''
            if text.startswith('OBSERVACIONES '):
                idf_id = section_id(text.replace('OBSERVACIONES ', ''))
            elif text and idf_id:
                observations.append({'idf_id': idf_id, 'text': text, 'source': provenance(file, index, table=len(doc), column=column + 1)})

    file = files[1]
    for index, row in enumerate(tables(directory / file)[0][1:], 2):
        number, model, serial, idf, location = row
        idf_id = f'idf-{int(idf)}' if idf.isdigit() else section_id(idf)
        add('ap', provenance(file, index, table=1), number=number, model=model, serial=serial,
            idf_id=idf_id, location=location, name=f'AP {number}', mac='', documented_ip='', kind='equipment', rack='')
        if not idf_id:
            assets[-1]['issues'].append('Gabinete no informado en el documento.')

    file = files[2]
    idf_id = ''
    for row in sheets(directory / file)['Hoja1']:
        number = row.get('B', '')
        if section_id(str(number)):
            idf_id = section_id(str(number))
        if not str(number).isdigit():
            continue
        relocated = row.get('H') is True
        destination = row.get('I', '')
        add('cctv', provenance(file, row['row'], sheet='Hoja1'), number=number, name=f'Cámara {number}',
            idf_id=idf_id, location=row.get('C', ''), serial=row.get('D', ''), model=row.get('E', ''),
            documented_ip=row.get('F', ''), mac=row.get('G', ''), relocated=relocated,
            destination=destination, kind='equipment', rack='')
        if bool(destination) != relocated:
            assets[-1]['issues'].append('La casilla de reubicación y el destino escrito no coinciden.')

    file = files[3]
    book = sheets(directory / file)
    aliases = {r.get('A'): r for r in book['MACS'] if re.fullmatch(r'A\d+', str(r.get('A', '')))}
    idf_id = ''
    for row in book['ubicacion']:
        label = row.get('A', '')
        if section_id(label):
            idf_id = section_id(label)
        if not label.startswith('C.'):
            continue
        alias = row.get('D', '')
        reference = aliases.get(alias, {})
        add('cctv_original', provenance(file, row['row'], sheet='ubicacion'), number=label, name=label,
            idf_id=idf_id, location=row.get('B', ''), plan=row.get('C', ''), ip_alias=alias,
            documented_ip=reference.get('C', ''), mac=reference.get('B', ''), serial='', model='',
            documented_site=row.get('F', ''), address_source=provenance(file, reference.get('row'), sheet='MACS'), kind='equipment', rack='')
        if section_id(row.get('F', '')) != idf_id:
            assets[-1]['issues'].append('SITE y el encabezado de sección indican gabinetes distintos.')
        if not reference:
            assets[-1]['issues'].append('No se encontró la clave de IP en la hoja MACS.')
    for dataset in ('idf', 'ap', 'cctv', 'cctv_original'):
        group = [a for a in assets if a['dataset'] == dataset]
        for key in ('serial', 'mac'):
            counts = Counter(re.sub(r'[^a-z0-9]', '', a.get(key, '').lower()) for a in group if a.get(key))
            for asset in group:
                value = re.sub(r'[^a-z0-9]', '', asset.get(key, '').lower())
                if value and counts[value] > 1:
                    asset['issues'].append(f'{key.upper()} repetida en el documento; no identifica un equipo único.')
    summary = {'networks': [], 'camera_counts': [], 'port_links': []}
    if structure:
        import msoffcrypto
        file = 'Estructura.xlsm'
        sources[file] = {'file': file, 'sha256': hashlib.sha256((directory / file).read_bytes()).hexdigest()}
        with (directory / file).open('rb') as stream:
            office = msoffcrypto.OfficeFile(stream)
            office.load_key(password=getpass.getpass('Contraseña de Estructura.xlsm: '))
            decrypted = io.BytesIO()
            office.decrypt(decrypted)
        decrypted.seek(0)
        book = sheets(decrypted)
        # Explicit field/coordinate allowlist. No credentials, arbitrary cells or diagrams.
        for row in book['Fortinet']:
            if 7 <= row['row'] <= 30:
                summary['networks'].append({'vlan': row.get('E'), 'name': row.get('F'), 'segment': row.get('H'), 'source': provenance(file, row['row'], sheet='Fortinet')})
        for row in book['CCTV']:
            if 62 <= row['row'] <= 75:
                summary['camera_counts'].append({'site': row.get('W'), 'installed': int(row['U']), 'planned': int(row['V']), 'source': provenance(file, row['row'], sheet='CCTV')})
        for row in book['Switch Distribución']:
            if 6 <= row['row'] <= 28:
                summary['port_links'].append({'port': row.get('L'), 'destination': row.get('M'), 'source': provenance(file, row['row'], sheet='Switch Distribución')})
    return {'schema_version': 1, 'source_directory': str(directory.resolve()), 'imported_at': datetime.now(timezone.utc).isoformat(),
            'sources': list(sources.values()), 'cabinets': cabinets, 'assets': assets,
            'observations': observations, 'structure': summary}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / '.sgrs-private/documentary.json')
    parser.add_argument('--structure', action='store_true')
    parser.add_argument('--replace', action='store_true', help='Replace a previous source snapshot; edits remain separate.')
    args = parser.parse_args()
    if args.output.exists() and not args.replace:
        parser.error('El catálogo ya existe. Usa otro destino para revisar o --replace para actualizar las fuentes.')
    data = extract(args.directory, args.structure)
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=args.output.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, args.output)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps({'assets': dict(Counter(a['dataset'] for a in data['assets'])),
                      'cabinets': len(data['cabinets']), 'observations': len(data['observations'])}))


if __name__ == '__main__':
    main()
