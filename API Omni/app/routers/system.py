from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse

router = APIRouter(
    prefix="/api/v1/system",
    tags=["Sistema y Diagnóstico"]
)


@router.get(
    "/health",
    response_model=ApiResponse[Dict[str, Any]],
    summary="Verificar Estado de Salud y Enlace",
    description="Comprueba la conectividad con OmniVista 2500, modo de autenticación en uso (API Key o Credenciales) y latencia.",
)
def health_check(
    service: OmniVistaService = Depends(get_ov_service)
):
    health_data = service.health_check()
    is_healthy = health_data.get("status") == "healthy"
    return ApiResponse(
        success=is_healthy,
        message=health_data.get("message", "Verificación completada"),
        data=health_data
    )


@router.get(
    "/version",
    response_model=ApiResponse[Any],
    summary="Versión del NMS OmniVista 2500",
    description="Obtiene información detallada de versión del sistema OmniVista NMS.",
)
def get_system_version(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        ver = service.get_system_version()
        return ApiResponse(
            success=True,
            message="Información de versión obtenida",
            data=ver
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
