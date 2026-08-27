import logging
import re
from typing import Any, Dict, Optional

# Configuración del logger de auditoría de seguridad
security_logger = logging.getLogger("fortinet_api.audit")
if not security_logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] [AUDIT-SECURITY] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    security_logger.addHandler(handler)
    security_logger.setLevel(logging.INFO)


def log_security_event(event_type: str, details: Dict[str, Any], level: int = logging.WARNING):
    """
    Registra un evento de seguridad de forma estructurada para auditoría y SIEM.
    Ejemplo:
        log_security_event("auth_failed", {"ip": "10.0.0.1", "path": "/api/v1/devices", "reason": "invalid_key"})
    """
    parts = [f"event={event_type}"]
    for k, v in details.items():
        parts.append(f"{k}={v}")
    security_logger.log(level, " | ".join(parts))


def mask_sensitive_ip(ip_or_url: Optional[str]) -> Optional[str]:
    """
    Enmascara direcciones IPv4 en respuestas y logs para evitar reconocimiento de la topología interna.
    Ejemplo: "192.168.10.254" -> "192.168.10.***"
             "https://192.168.10.254:443" -> "https://192.168.10.***:443"
    """
    if not ip_or_url:
        return ip_or_url

    def _mask(match):
        octets = match.group(0).split(".")
        return f"{octets[0]}.{octets[1]}.{octets[2]}.***"

    return re.sub(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", _mask, str(ip_or_url))
