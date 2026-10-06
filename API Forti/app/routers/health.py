import time
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, status

from app.core.config import settings
from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.security.logging import mask_sensitive_ip

router = APIRouter(
    prefix="/health",
    tags=["Salud y Conectividad"],
    dependencies=[Depends(verify_api_key)],
)
_START_TIME = time.time()


def _mask_serial(serial: Optional[str]) -> Optional[str]:
    if not serial or len(serial) < 6:
        return "******"
    return f"{serial[:3]}****{serial[-3:]}"


@router.get(
    "",
    response_model=BaseResponse[Dict[str, Any]],
    summary="Estado de salud de la API y verificación de conexión con FortiGate",
)
async def check_health():
    """
    Verifica que la API en el puerto 8001 esté operativa y prueba la conectividad
    en tiempo real contra el FortiGate. Enmascara datos sensibles de red si MASK_INTERNAL_IPS está activo.
    """
    uptime_seconds = int(time.time() - _START_TIME)

    raw_host = f"{settings.FORTIOS_SCHEME}://{settings.FORTIOS_HOST}:{settings.FORTIOS_PORT}"
    display_host = mask_sensitive_ip(raw_host) if settings.MASK_INTERNAL_IPS else raw_host

    fortigate_status: Dict[str, Any] = {
        "configured_host": display_host,
        "token_configured": bool(settings.FORTIOS_API_TOKEN and settings.FORTIOS_API_TOKEN != "tu_token_aqui"),
        "reachable": False,
        "authenticated": False,
        "message": "Pendiente de verificación",
    }

    try:
        status_res = await fortios_client.get_system_status()
        if status_res:
            fortigate_status["reachable"] = True
            fortigate_status["authenticated"] = True
            fortigate_status["message"] = "Conexión y autenticación con FortiOS exitosas."
            results = status_res.get("results", {})
            if isinstance(results, dict):
                fortigate_status["fortigate_hostname"] = results.get("hostname")
                fortigate_status["fortios_version"] = results.get("version")
                raw_serial = results.get("serial")
                fortigate_status["serial"] = _mask_serial(raw_serial) if settings.MASK_INTERNAL_IPS else raw_serial
    except Exception as exc:
        fortigate_status["message"] = "Error al contactar con FortiGate"

    return BaseResponse(
        success=True,
        message="Servicio de API operativo.",
        data={
            "app_name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "port": settings.PORT,
            "uptime_seconds": uptime_seconds,
            "environment": settings.ENVIRONMENT,
            "fortigate_connection": fortigate_status,
        },
    )
