"""Verify mobile QR reporting through HTTP on the LAN with disposable files."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import dashboard_access as access
import dashboard_reports as reports
import run
import server


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


with tempfile.TemporaryDirectory(prefix='sgrs-mobile-lan-') as directory:
    private = Path(directory)
    access.PRIVATE = private
    reports.PRIVATE = private
    server.IDFS_FILE = str(private / 'idfs.json')
    server.REPORTS_FILE = str(private / 'reports.json')
    Path(server.IDFS_FILE).write_text(json.dumps([{'id': 'idf-6', 'name': 'IDF 06', 'zone': 'Prueba LAN'}]))
    Path(server.REPORTS_FILE).write_text('{}')
    httpd = server.ThreadedHTTPServer(('0.0.0.0', 0), QuietHandler)
    origin = f'http://{run.local_network_ip()}:{httpd.server_port}'
    os.environ['SGRS_PUBLIC_ORIGIN'] = ''
    os.environ['SGRS_LAN_ORIGIN'] = origin
    token = reports.mobile_token('idf-6')
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        result = subprocess.run(['node', 'tests/mobile-report-browser.mjs'], cwd=ROOT / 'Dashboard', capture_output=True, text=True,
                                env={**os.environ, 'SGRS_MOBILE_TEST_ORIGIN': origin, 'SGRS_MOBILE_TEST_TOKEN': token})
        print((result.stdout + result.stderr).replace(token, '<REDACTED>'))
        if result.returncode:
            raise SystemExit(result.returncode)
        stored = json.loads(Path(server.REPORTS_FILE).read_text(encoding='utf-8'))['idf-6']['incidents']
        assert len(stored) == 1
        assert stored[0]['temp'] == 23.5
        assert stored[0]['description'] == 'Prueba aislada de reporte móvil'
        print('PASS: exactly one report persisted in isolated IDF records')
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
