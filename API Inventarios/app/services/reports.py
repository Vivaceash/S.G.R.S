"""Read-only access to the dashboard's IDF report log."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.core.errors import InventoryError


REPORTS_FILE = Path(__file__).resolve().parents[3] / "data" / "reports.json"
_PRIVATE_FIELDS = {"actor_id", "resolved_by", "evidence", "record_key"}


def _record_key(row: dict[str, Any]) -> str:
    payload = {key: value for key, value in row.items() if key not in _PRIVATE_FIELDS}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _read() -> dict[str, Any]:
    try:
        with REPORTS_FILE.open(encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise InventoryError(503, "La bitácora IDF no está disponible.", "reports_unavailable") from exc
    if not isinstance(data, dict):
        raise InventoryError(503, "La bitácora IDF no tiene un formato válido.", "reports_unavailable")
    return data


def _rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idf_id, group in data.items():
        incidents = group if isinstance(group, list) else group.get("incidents", []) if isinstance(group, dict) else []
        if not isinstance(incidents, list):
            continue
        for incident in incidents:
            if not isinstance(incident, dict):
                continue
            public = {key: value for key, value in incident.items() if key not in _PRIVATE_FIELDS}
            public["idf_id"] = idf_id
            public["record_key"] = _record_key(public)
            rows.append(public)
    return rows


def query(*, idf_id: str | None = None, status: str | None = None,
          severity: str | None = None, q: str = "", sort: str = "date",
          descending: bool = True, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    data = _read()
    rows = _rows(data)
    if idf_id is not None:
        rows = [row for row in rows if row["idf_id"] == idf_id]
    if status is not None:
        rows = [row for row in rows if row.get("status") == status]
    if severity is not None:
        rows = [row for row in rows if row.get("severity") == severity]
    if q:
        needle = q.casefold()
        rows = [row for row in rows if needle in " ".join(str(value) for value in row.values()).casefold()]
    rows.sort(key=lambda row: (str(row.get(sort, "")), str(row.get("id", ""))), reverse=descending)
    return {"items": rows[offset:offset + limit], "total": len(rows), "limit": limit, "offset": offset}

