from typing import Any, Dict, Set


SENSITIVE_KEY_PATTERNS: Set[str] = {
    "password",
    "pass",
    "secret",
    "psk",
    "private_key",
    "token",
    "api_key",
    "credential",
    "authorization",
}


def is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(pattern in normalized for pattern in SENSITIVE_KEY_PATTERNS)


def sanitize_data(value: Any) -> Any:
    """Enmascara recursivamente secretos en respuestas recibidas del NMS."""
    if isinstance(value, dict):
        cleaned: Dict[str, Any] = {}
        for key, item in value.items():
            if is_sensitive_key(str(key)):
                cleaned[key] = "******" if item is not None else None
            else:
                cleaned[key] = sanitize_data(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize_data(item) for item in value]
    return value
