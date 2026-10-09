"""Server-owned device presence sampling, independent of browser sessions."""
import json
import logging
import threading

from dashboard_access import database
from dashboard_device_history import record_device_presence

INTERVAL_SECONDS = 60
DEVICE_PATH = '/devices?view=operational&status=all&active_window=3600'
logger = logging.getLogger(__name__)


def collect_presence(fetch, now=None):
    code, body, _ = fetch('forti', DEVICE_PATH)
    if code != 200:
        raise ValueError('Device provider unavailable')
    payload = json.loads(body)
    if payload.get('success') is False or payload.get('error'):
        raise ValueError('Device provider failed')
    data = payload.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('devices'), list):
        raise ValueError('Invalid device inventory')
    devices = data['devices']
    if any(not isinstance(device, dict) for device in devices):
        raise ValueError('Invalid device record')
    if data.get('returned_count', len(devices)) != len(devices):
        raise ValueError('Incomplete device inventory')
    return record_device_presence(devices, now=now)


def presence_snapshot():
    with database() as db:
        return {row['mac']: dict(row) for row in db.execute('SELECT * FROM device_connection_history')}


def start_presence_collector(fetch, interval=INTERVAL_SECONDS):
    stop = threading.Event()

    def run():
        while not stop.is_set():
            try:
                collect_presence(fetch)
            except Exception:
                logger.warning('Device presence sample failed; preserving last confirmed history.')
            stop.wait(interval)

    thread = threading.Thread(target=run, name='sgrs-device-presence', daemon=True)
    thread.start()
    return stop
