"""Validated, attributed mobile reports and protected photographic evidence."""
import base64
import binascii
from datetime import datetime, timezone
import json
import math
import os
import re
import tempfile
from pathlib import Path

from dashboard_access import AccessError, PRIVATE


class ReportRoutes:
    def save_report(self, body):
        incident = body.get("incident")
        idf_id = body.get("idf_id")
        if not isinstance(incident, dict) or not isinstance(idf_id, str):
            raise AccessError(422, "Completa los datos del registro.")
        report_id = incident.get("id", "")
        if not re.fullmatch(r"IDF-[a-fA-F0-9-]{36}", str(report_id)):
            raise AccessError(422, "El identificador del registro no es válido.")
        try:
            temp = float(incident.get("temp"))
        except (ValueError, TypeError):
            raise AccessError(422, "Indica una temperatura entre 10 y 42 °C.") from None
        description = incident.get("description", "")
        if not math.isfinite(temp) or not 10 <= temp <= 42 or not isinstance(description, str) or not 1 <= len(description.strip()) <= 1600:
            raise AccessError(422, "Revisa la temperatura y el motivo de ingreso.")
        actor = self.identity["user"]
        now = datetime.now(timezone.utc).isoformat()
        has_issue = incident.get("status") == "open"
        saved = {"id": report_id, "date": now, "severity": "medium" if has_issue else "low", "device": "Gabinete", "temp": temp,
                 "title": "Visita con inconvenientes" if has_issue else "Registro de entrada", "description": description.strip(),
                 "status": "open" if has_issue else "resolved", "tech": actor["name"], "actor_id": actor["id"]}
        telemetry = {"date": now, "temp": temp, "status": "critical" if temp >= 28 else "warn" if temp >= 24 else "normal"}
        evidence = body.get("evidence")
        image = None
        if evidence:
            if not isinstance(evidence, dict) or evidence.get("type") not in ("image/png", "image/jpeg"):
                raise AccessError(422, "Selecciona una imagen PNG o JPG.")
            try:
                image = base64.b64decode(evidence.get("data", ""), validate=True)
            except (ValueError, TypeError, binascii.Error):
                raise AccessError(422, "La imagen no es válida.") from None
            signature = b"\x89PNG\r\n\x1a\n" if evidence["type"] == "image/png" else b"\xff\xd8\xff"
            if not image.startswith(signature) or not 0 < len(image) <= 10 * 1024 * 1024:
                raise AccessError(422, "La imagen debe ser PNG/JPG y no superar 10 MB.")
            saved["evidence"] = f"{report_id}.{'png' if evidence['type'] == 'image/png' else 'jpg'}"
        reports_file, idfs_file, lock = self.report_context()
        with lock:
            with open(idfs_file, encoding="utf-8") as stream:
                idfs = json.load(stream)
            if not any(row.get("id") == idf_id for row in idfs):
                raise AccessError(422, "Selecciona un IDF del catálogo.")
            with open(reports_file, encoding="utf-8") as stream:
                reports = json.load(stream)
            for group in reports.values():
                for row in group if isinstance(group, list) else group.get("incidents", []):
                    if row.get("id") == report_id:
                        if row.get("actor_id") != actor["id"]:
                            raise AccessError(409, "Ese identificador ya está en uso.")
                        self._send_json({"status": "success", "incident": row, "duplicate": True})
                        return
            previous = reports.get(idf_id, {})
            incidents = previous if isinstance(previous, list) else previous.get("incidents", [])
            reports[idf_id] = {"incidents": [saved, *incidents], "telemetry": telemetry}
            if image:
                evidence_dir = PRIVATE / "evidence"
                evidence_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd = os.open(evidence_dir / saved["evidence"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(image)
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=Path(reports_file).parent, delete=False) as stream:
                    temp_path = stream.name
                    json.dump(reports, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp_path, reports_file)
            except Exception:
                if temp_path and os.path.exists(temp_path):
                    os.unlink(temp_path)
                if image:
                    (PRIVATE / "evidence" / saved["evidence"]).unlink(missing_ok=True)
                raise
        self._send_json({"status": "success", "incident": saved, "telemetry": telemetry})

    def send_evidence(self, identifier):
        if not re.fullmatch(r"IDF-[a-fA-F0-9-]{36}\.(png|jpg)", identifier):
            raise AccessError(404, "Evidencia no encontrada.")
        path = PRIVATE / "evidence" / identifier
        if not path.is_file():
            raise AccessError(404, "Evidencia no encontrada.")
        # Download only: never execute or render untrusted uploads in the app origin.
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{identifier}"')
        self.send_header("Content-Length", str(path.stat().st_size))
        self.end_headers()
        with path.open("rb") as stream:
            while chunk := stream.read(65536):
                self.wfile.write(chunk)
