import logging
import re
from typing import Optional, Dict, Any

# Configuración del logger de auditoría de seguridad
security_logger = logging.getLogger("api_security")
if not security_logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] [AUDIT-SECURITY] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    security_logger.addHandler(handler)
    security_logger.setLevel(logging.INFO)


def log_security_event(event_type: str, details: Dict[str, Any], level: int = logging.WARNING):
    """Registra un evento de seguridad de forma estructurada"""
    def safe_log_value(value: Any) -> str:
        text = str(value).replace("\r", "\\r").replace("\n", "\\n")
        return "".join(ch if ch.isprintable() else "?" for ch in text)[:512]

    parts = [f"event={safe_log_value(event_type)}"]
    for k, v in details.items():
        parts.append(f"{safe_log_value(k)}={safe_log_value(v)}")
    security_logger.log(level, " | ".join(parts))


def mask_sensitive_ip(ip_or_url: str) -> str:
    """
    Enmascara direcciones IP privadas en respuestas públicas para evitar
    reconocimiento de topología interna (ej. https://192.168.10.201 -> https://192.168.10.***)
    """
    if not ip_or_url:
        return ip_or_url

    # Regex para IPv4
    def _mask(match):
        octets = match.group(0).split(".")
        return f"{octets[0]}.{octets[1]}.{octets[2]}.***"

    return re.sub(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", _mask, ip_or_url)
