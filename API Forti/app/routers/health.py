import time
from typing import Any, Dict
from fastapi import APIRouter, status
import httpx

from app.core.config import settings
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse

router = APIRouter(prefix="/health", tags=["Salud y Conectividad"])
_START_TIME = time.time()


@router.get(
    "",
    response_model=BaseResponse[Dict[str, Any]],
    summary="Estado de salud de la API y verificación de conexión con FortiGate",
)
async def check_health():
    """
    Verifica que la API local en el puerto 8001 esté operativa y prueba la conectividad
    en tiempo real contra el FortiGate configurado en .env.
    """
    uptime_seconds = int(time.time() - _START_TIME)

    fortigate_status = {
        "configured_host": f"{settings.FORTIOS_SCHEME}://{settings.FORTIOS_HOST}:{settings.FORTIOS_PORT}",
        "token_configured": bool(settings.FORTIOS_API_TOKEN and settings.FORTIOS_API_TOKEN != "tu_token_aqui"),
        "reachable": False,
        "authenticated": False,
        "message": "Pendiente de verificación",
    }

    try:
        # Intentar una llamada rápida al monitor de estado de FortiOS
        status_res = await fortios_client.get_system_status()
        if status_res:
            fortigate_status["reachable"] = True
            fortigate_status["authenticated"] = True
            fortigate_status["message"] = "Conexión y autenticación con FortiOS exitosas."
            results = status_res.get("results", {})
            if isinstance(results, dict):
                fortigate_status["fortigate_hostname"] = results.get("hostname")
                fortigate_status["fortios_version"] = results.get("version")
                fortigate_status["serial"] = results.get("serial")
    except Exception as exc:
        fortigate_status["message"] = f"Aviso de conexión: {str(exc)}"

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
