"""Read-only audit projection with original IDF dates and human-readable targets."""
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dashboard_access import database
from dashboard_reports import report_key

try:
    LOCAL_TIME = ZoneInfo('America/Mexico_City')
except ZoneInfoNotFoundError:
    # Current deployment's local offset when the host has no IANA database.
    LOCAL_TIME = timezone(timedelta(hours=-6))


def audit_timestamp(value):
    """Return Unix seconds; an undated historical reference must stay undated."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r'\d+(?:\.\d+)?', value.strip())):
        number = float(value)
        if not math.isfinite(number):
            return None
        return int(number / 1000 if abs(number) >= 100_000_000_000 else number)
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        parsed = None
        for pattern in ('%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M', '%d/%m/%Y'):
            try:
                parsed = datetime.strptime(raw, pattern)
                break
            except ValueError:
                pass
    if parsed is None:
        return None
    try:
        return int((parsed if parsed.tzinfo else parsed.replace(tzinfo=LOCAL_TIME)).timestamp())
    except (ValueError, OverflowError, OSError):
        return None


def _read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def audit_events(reports_file, idfs_file):
    cabinets = _read_json(idfs_file, [])
    groups = _read_json(reports_file, {})
    cabinets = cabinets if isinstance(cabinets, list) else []
    groups = groups if isinstance(groups, dict) else {}
    names = {row['id']: row.get('name') or row['id'].upper() for row in cabinets if isinstance(row, dict) and row.get('id')}
    reports = {}

    def collect(idf_id, rows):
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            identifier = row.get('origin_key') or row.get('id') or report_key(row)
            reports[(idf_id, identifier)] = row

    for cabinet in cabinets:
        if isinstance(cabinet, dict) and cabinet.get('id'):
            collect(cabinet['id'], cabinet.get('incidents', []))
    # Stored reports supersede their embedded historical snapshot.
    for idf_id, group in groups.items():
        collect(idf_id, group if isinstance(group, list) else group.get('incidents', []) if isinstance(group, dict) else [])
    by_target = {}
    aliases = {}
    for (idf_id, identifier), row in reports.items():
        refs = {f'{idf_id}:{identifier}', identifier}
        for key in ('id', 'origin_key'):
            if row.get(key):
                refs.update((str(row[key]), f'{idf_id}:{row[key]}'))
        refs.add(f'{idf_id}:{report_key(row)}')
        aliases[(idf_id, identifier)] = refs
        by_target.update({ref: (idf_id, row) for ref in refs})

    def target_label(action, target, users):
        if action.startswith(('user.', 'session.')) and target in users:
            return f"{'Sesión' if action.startswith('session.') else 'Usuario'} {users[target]}"
        if action.startswith('connection.'):
            return f'Servicio {target.upper()}'
        match = by_target.get(target)
        if match:
            idf_id, row = match
            return f"{names.get(idf_id, idf_id.upper())} · {row.get('title') or 'Registro IDF'}"
        idf_id = target.split(':', 1)[0]
        if re.fullmatch(r'idf-[\w-]+', idf_id, re.IGNORECASE):
            return f"{names.get(idf_id, idf_id.upper())} · {'Movimiento de inventario' if action.startswith('support.') else 'Registro IDF'}"
        return target

    with database() as db:
        users = {row['id']: row['name'] or row['username'] for row in db.execute('SELECT id,name,username FROM users')}
        known = {(row['action'], row['target']) for row in db.execute("SELECT action,target FROM audit WHERE action LIKE 'idf.report.%'")}
        events = [dict(row) for row in db.execute('''
            SELECT a.id,a.actor,COALESCE(u.name,u.username,a.actor) AS actor_name,
                   COALESCE(u.username,'') AS username,COALESCE(u.role,'') AS user_role,
                   a.action,a.target,a.created_at,a.details
            FROM audit a LEFT JOIN users u ON u.id=a.actor
            ORDER BY a.id DESC LIMIT 300
        ''')]
    for event in events:
        event['target_label'] = target_label(event['action'], event.get('target') or '', users)
        event['source'] = 'audit'

    for (idf_id, identifier), row in reports.items():
        refs = aliases[(idf_id, identifier)]
        for action, date, actor in (
            ('idf.report.created', row.get('date'), row.get('actor_id') or 'operativo'),
            ('idf.report.resolved', row.get('resolved_at'), row.get('resolved_by') or row.get('actor_id') or 'operativo'),
        ):
            if action.endswith('resolved') and not row.get('resolved_at'):
                continue
            if any((action, ref) in known for ref in refs):
                continue
            target = f'{idf_id}:{identifier}'
            events.append({
                'id': f"history-{action}-{idf_id}-{identifier}", 'actor': actor,
                'actor_name': users.get(actor) or row.get('tech') or 'Técnico de campo',
                'username': '', 'user_role': 'operativo', 'action': action,
                'target': target, 'target_label': target_label(action, target, users),
                'created_at': audit_timestamp(date), 'original_date': date,
                'details': row.get('description') or '', 'source': 'report-history',
            })
    events.sort(key=lambda event: (event.get('created_at') is not None, event.get('created_at') or 0), reverse=True)
    return events[:400]
