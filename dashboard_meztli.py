"""Gestión Meztli - Alta de derechohabientes (tickets y registro de acceso de pacientes)."""
import re
import secrets
import sqlite3
import time
from dashboard_access import database, AccessError, audit

VALID_STATUSES = ("pending", "in_progress", "attended", "cancelled")


def init_meztli_db(db):
    """Ensure the meztli_derechohabientes table exists."""
    db.executescript("""
      CREATE TABLE IF NOT EXISTS meztli_derechohabientes (
        id TEXT PRIMARY KEY,
        folio TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        room_bed TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        requested_by TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        attended_by TEXT NOT NULL DEFAULT '',
        attended_at INTEGER,
        response_notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meztli_dh_status ON meztli_derechohabientes(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_meztli_dh_dates ON meztli_derechohabientes(start_date, end_date);
      CREATE TABLE IF NOT EXISTS meztli_derechohabiente_messages (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        body TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(ticket_id) REFERENCES meztli_derechohabientes(id)
      );
      CREATE INDEX IF NOT EXISTS idx_meztli_dh_messages_ticket
        ON meztli_derechohabiente_messages(ticket_id, created_at ASC);
    """)


def row_to_dict(row):
    if not row:
        return None
    d = dict(row)
    return d


def list_derechohabientes(status=None, query=None):
    """List derechohabientes tickets with optional status and text filters."""
    with database() as db:
        init_meztli_db(db)
        sql = "SELECT * FROM meztli_derechohabientes"
        params = []
        conditions = []

        if status and status in VALID_STATUSES:
            conditions.append("status = ?")
            params.append(status)

        if query:
            q = f"%{query.strip().lower()}%"
            conditions.append("(LOWER(patient_name) LIKE ? OR LOWER(folio) LIKE ? OR LOWER(department) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(requested_by) LIKE ?)")
            params.extend([q, q, q, q, q])

        if conditions:
            sql += " WHERE " + " AND ".join(conditions)

        sql += " ORDER BY created_at DESC LIMIT 500"
        rows = db.execute(sql, params).fetchall()
        return [row_to_dict(r) for r in rows]


def create_derechohabiente(data, actor_id, actor_name):
    """Create a new derechohabiente registration ticket."""
    patient_name = str(data.get("patient_name") or "").strip()
    if len(patient_name) < 3:
        raise AccessError(422, "El nombre del paciente debe tener al menos 3 caracteres.")

    start_date = str(data.get("start_date") or "").strip()
    end_date = str(data.get("end_date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date):
        raise AccessError(422, "Las fechas deben tener el formato AAAA-MM-DD.")
    if end_date < start_date:
        raise AccessError(422, "La fecha de fin no puede ser anterior a la fecha de inicio.")

    department = str(data.get("department") or "").strip()
    room_bed = str(data.get("room_bed") or "").strip()
    notes = str(data.get("notes") or "").strip()
    # Times and free-text requester are intentionally not collected in the
    # streamlined form. Keep the legacy columns empty/derived for existing
    # databases and historical exports.
    entry_time = ""
    exit_time = ""
    requested_by = str(actor_name or "").strip()

    now = int(time.time())
    item_id = f"dh_{secrets.token_hex(8)}"

    with database(write=True) as db:
        init_meztli_db(db)
        # Generate friendly folio: DH-YYYY-XXXX
        year = time.strftime("%Y", time.localtime(now))
        count = db.execute("SELECT COUNT(*) FROM meztli_derechohabientes WHERE folio LIKE ?", (f"DH-{year}-%",)).fetchone()[0]
        folio = f"DH-{year}-{count + 1:04d}"

        db.execute("""
          INSERT INTO meztli_derechohabientes (
            id, folio, patient_name, start_date, end_date, entry_time, exit_time,
            department, room_bed, notes, requested_by, status, attended_by, attended_at,
            response_notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, '', ?, ?)
        """, (
            item_id, folio, patient_name, start_date, end_date, entry_time, exit_time,
            department, room_bed, notes, requested_by, now, now
        ))
        audit(db, actor_id or "system", "meztli.alta.created", folio)
        row = db.execute("SELECT * FROM meztli_derechohabientes WHERE id=?", (item_id,)).fetchone()
        return row_to_dict(row)


def list_derechohabiente_messages(ticket_id):
    """Return the operational follow-up thread for one ticket."""
    with database() as db:
        init_meztli_db(db)
        ticket = db.execute("SELECT id FROM meztli_derechohabientes WHERE id=?", (ticket_id,)).fetchone()
        if not ticket:
            raise AccessError(404, "El ticket de derechohabiente no existe.")
        rows = db.execute(
            "SELECT * FROM meztli_derechohabiente_messages WHERE ticket_id=? ORDER BY created_at ASC, id ASC",
            (ticket_id,),
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def add_derechohabiente_message(ticket_id, body, actor_id, actor_name):
    """Add a requester/NOC follow-up and reopen the ticket for attention."""
    message = str(body or "").strip()
    if len(message) < 3:
        raise AccessError(422, "Describe el seguimiento con al menos 3 caracteres.")
    if len(message) > 1000:
        raise AccessError(422, "El mensaje de seguimiento no puede superar 1,000 caracteres.")

    now = int(time.time())
    with database(write=True) as db:
        init_meztli_db(db)
        ticket = db.execute("SELECT * FROM meztli_derechohabientes WHERE id=?", (ticket_id,)).fetchone()
        if not ticket:
            raise AccessError(404, "El ticket de derechohabiente no existe.")
        if ticket["status"] == "cancelled":
            raise AccessError(409, "El ticket está cancelado; crea una nueva solicitud si aún se requiere acceso.")

        message_id = f"dhm_{secrets.token_hex(8)}"
        db.execute(
            "INSERT INTO meztli_derechohabiente_messages VALUES(?,?,?,?,?,?)",
            (message_id, ticket_id, message, actor_id or "system", actor_name or "Personal hospitalario", now),
        )
        # A follow-up such as a new disconnection is an actionable request for NOC.
        db.execute(
            "UPDATE meztli_derechohabientes SET status='pending', updated_at=? WHERE id=?",
            (now, ticket_id),
        )
        audit(db, actor_id or "system", "meztli.alta.follow_up", ticket["folio"])
        saved_message = db.execute("SELECT * FROM meztli_derechohabiente_messages WHERE id=?", (message_id,)).fetchone()
        updated_ticket = db.execute("SELECT * FROM meztli_derechohabientes WHERE id=?", (ticket_id,)).fetchone()
        return {"message": row_to_dict(saved_message), "item": row_to_dict(updated_ticket)}


def update_derechohabiente_status(alta_id, new_status, actor_id, actor_name, response_notes=""):
    """Update the status of a derechohabiente ticket (e.g. mark as attended)."""
    if not alta_id:
        raise AccessError(422, "Se requiere el ID del ticket.")
    if new_status not in VALID_STATUSES:
        raise AccessError(422, f"Estado no válido. Opciones: {', '.join(VALID_STATUSES)}.")

    now = int(time.time())
    with database(write=True) as db:
        init_meztli_db(db)
        old = db.execute("SELECT * FROM meztli_derechohabientes WHERE id=?", (alta_id,)).fetchone()
        if not old:
            raise AccessError(404, "El ticket de derechohabiente no existe.")

        attended_by = actor_name if new_status == "attended" else (old["attended_by"] or "")
        attended_at = now if new_status == "attended" else old["attended_at"]
        notes = str(response_notes or old["response_notes"] or "").strip()

        db.execute("""
          UPDATE meztli_derechohabientes
          SET status=?, attended_by=?, attended_at=?, response_notes=?, updated_at=?
          WHERE id=?
        """, (new_status, attended_by, attended_at, notes, now, alta_id))

        audit(db, actor_id or "system", f"meztli.alta.{new_status}", old["folio"])
        updated = db.execute("SELECT * FROM meztli_derechohabientes WHERE id=?", (alta_id,)).fetchone()
        return row_to_dict(updated)
