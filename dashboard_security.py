"""Response minimization for integration data, never for authentication tokens."""
import re


def sanitize_upstream(value, secrets=()):
    sensitive = ("password", "passwd", "secret", "psk", "privatekey", "token",
                 "apikey", "accesskey", "presharedkey", "credential", "authorization", "cookie", "sessionid")
    if isinstance(value, dict):
        return {key: ("******" if item is not None else None)
                if any(word in re.sub(r"[^a-z0-9]", "", str(key).lower()) for word in sensitive)
                else sanitize_upstream(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_upstream(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "******")
    return value
