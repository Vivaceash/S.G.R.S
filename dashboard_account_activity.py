"""Read-only account activity assessment from complete provider snapshots."""


def assess_activity(devices, *, users_complete, devices_complete, forti_complete):
    if not (users_complete and devices_complete and forti_complete):
        return {"status": "unknown", "reason": "Consulta incompleta; no se puede confirmar inactividad."}
    if not devices:
        return {"status": "unknown", "reason": "Sin dispositivos asociados para cotejar por MAC con FortiGate."}
    # A missing field means the provider did not expose the evidence, unlike an
    # explicitly empty/null authentication time.
    if any(device.get("forti") for device in devices):
        return {"status": "observed", "reason": "FortiGate conserva evidencia de un dispositivo asociado."}
    if any("lastAuthenticationTime" not in device for device in devices):
        return {"status": "unknown", "reason": "OmniVista no informó la última autenticación de todos los equipos."}
    empty_values = ("", "null", "none")
    if any(device.get("lastAuthenticationTime") is not None and str(device["lastAuthenticationTime"]).strip().lower() not in empty_values for device in devices):
        return {"status": "authenticated", "reason": "OmniVista conserva una fecha de autenticación; no cumple el criterio de fecha vacía."}
    # Without a valid MAC, a negative lookup cannot establish absence in Forti.
    if any(len(''.join(c for c in str(device.get("deviceMac") or '').lower() if c in '0123456789abcdef')) != 12
           or ''.join(c for c in str(device.get("deviceMac") or '').lower() if c in '0123456789abcdef') in ('000000000000', 'ffffffffffff') for device in devices):
        return {"status": "unknown", "reason": "Falta una MAC válida para cotejar todos los equipos con FortiGate."}
    if any(device.get("asociacion") == "deviceName-prefijo" for device in devices):
        return {"status": "unknown", "reason": "La asociación de cuenta por prefijo requiere confirmación."}
    return {"status": "inactive", "reason": "Última autenticación vacía en todos los equipos de OmniVista y sin coincidencias en FortiGate. No indica días de inactividad."}
