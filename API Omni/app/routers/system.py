from typing import Dict, Any
from fastapi import APIRouter, Depends
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
    description="Comprueba el estado del backend y valida la conectividad en vivo con el servidor Alcatel OmniVista 2500.",
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
