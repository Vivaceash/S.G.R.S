"""End-to-end support QR test with disposable account, records and HTTP server."""
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
import server


class QuietHandler(server.Handler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix='sgrs-support-qr-') as directory:
    private = Path(directory)
    access.PRIVATE = private
    reports.PRIVATE = private
    server.IDFS_FILE = str(private / 'idfs.json')
    server.REPORTS_FILE = str(private / 'reports.json')
    Path(server.IDFS_FILE).write_text(json.dumps([{'id': 'idf-1', 'name': 'IDF 1', 'zone': 'Planta baja'}]))
    Path(server.REPORTS_FILE).write_text('{}')
    owner = access.save_user({'username': 'owner.test', 'name': 'Dueño de prueba',
                              'role': 'super-admin', 'password': 'OwnerTestPass123!'}, bootstrap=True)
    access.save_user({'username': 'support.qr', 'name': 'Soporte de prueba',
                      'role': 'soporte', 'password': 'SupportTestPass123!'}, actor=owner['id'])
    httpd = server.ThreadedHTTPServer(('127.0.0.1', 0), QuietHandler)
    origin = f'http://127.0.0.1:{httpd.server_port}'
    os.environ['SGRS_PUBLIC_ORIGIN'] = ''
    os.environ['SGRS_LAN_ORIGIN'] = origin
    token = reports.mobile_token('idf-1')
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        result = subprocess.run(['node', 'tests/support-qr-live-browser.mjs'], cwd=ROOT / 'Dashboard',
                                capture_output=True, text=True, encoding='utf-8', errors='replace',
                                env={**os.environ, 'SGRS_TEST_ORIGIN': origin, 'SGRS_TEST_TOKEN': token})
        print((result.stdout + result.stderr).replace(token, '<REDACTED>'))
        if result.returncode:
            raise SystemExit(result.returncode)
        saved = json.loads((private / 'support-movements.json').read_text())
        assert len(saved) == 1 and saved[0]['identifier'] == 'TON-E2E-001'
        assert json.loads(Path(server.REPORTS_FILE).read_text()) == {}
        print('PASS: isolated support record saved; IDF incidence log unchanged')
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
