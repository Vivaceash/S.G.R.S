"""Run the browser preference regression with real login and a disposable database.

From the repository root: .venv/bin/python Dashboard/tests/overview-preferences-server.py
"""
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import server
import dashboard_access as access


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


with tempfile.TemporaryDirectory(prefix='sgrs-preferences-') as directory:
    access.PRIVATE = Path(directory)
    username = 'preferences.verify'
    password = secrets.token_urlsafe(24)
    access.save_user({'username': username, 'name': 'Prueba aislada', 'role': 'super-admin', 'password': password}, bootstrap=True)
    httpd = server.ThreadedHTTPServer(('127.0.0.1', 0), QuietHandler)
    url = f'http://127.0.0.1:{httpd.server_port}'
    os.environ['SGRS_PUBLIC_ORIGIN'] = ''
    os.environ['SGRS_LAN_ORIGIN'] = url
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        result = subprocess.run(['node', 'tests/overview-preferences-browser.mjs'], cwd=ROOT / 'Dashboard', env={**os.environ, 'SGRS_TEST_URL': url, 'SGRS_PREFERENCES_REAL_AUTH': '1', 'SGRS_PREFERENCES_USER': username, 'SGRS_PREFERENCES_PASSWORD': password})
        with access.database() as db:
            assert db.execute('SELECT COUNT(*) FROM dashboard_preferences').fetchone()[0] == 1
        raise SystemExit(result.returncode)
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
