import copy
from typing import Any, Dict, List, Set, Union

# Conjunto de nombres de campos sensibles que no deben exponerse en texto plano
SENSITIVE_KEY_PATTERNS: Set[str] = {
    "password",
    "pass",
    "secret",
    "psk",
    "psksecret",
    "private_key",
    "token",
    "api_token",
    "pre_shared_key",
    "credential",
    "auth_password",
}


def is_sensitive_key(key: str) -> bool:
    """Verifica si una clave coincide con nombres de campos sensibles."""
    lower = key.lower().replace("-", "_")
    return any(pattern in lower for pattern in SENSITIVE_KEY_PATTERNS)


def sanitize_data(obj: Any) -> Any:
    """
    Sanea recursivamente estructuras de datos (diccionarios o listas) reemplazando
    valores de campos sensibles por '******'.
    """
    if isinstance(obj, dict):
        cleaned: Dict[str, Any] = {}
        for k, v in obj.items():
            if is_sensitive_key(str(k)):
                cleaned[k] = "******" if v is not None else None
            elif isinstance(v, (dict, list)):
                cleaned[k] = sanitize_data(v)
            else:
                cleaned[k] = v
        return cleaned
    elif isinstance(obj, list):
        return [sanitize_data(item) for item in obj]
    return obj
