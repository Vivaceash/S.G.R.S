from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from app.config import settings
from app.dependencies import get_ov_service, verify_api_key
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.security import mask_sensitive_ip

router = APIRouter(
    tags=["Sistema y Diagnóstico"],
)


@router.get(
    "/api/v1/system/health",
    response_model=ApiResponse[Dict[str, Any]],
    summary="Verificar Estado de Salud y Enlace",
    description="Comprueba la conectividad con OmniVista 2500, latencia y disponibilidad del servicio.",
)
@router.get(
    "/api/v1/health",
    response_model=ApiResponse[Dict[str, Any]],
    summary="Verificar Estado de Salud y Enlace (Alias /api/v1/health)",
    description="Comprueba la conectividad con OmniVista 2500, latencia y disponibilidad del servicio.",
)
def health_check(
    service: OmniVistaService = Depends(get_ov_service)
):
    health_data = service.health_check()
    is_healthy = health_data.get("status") == "healthy"

    # Enmascarar IP interna si está habilitado por configuración de seguridad
    if settings.MASK_INTERNAL_IPS and "omnivista_host" in health_data:
        health_data["omnivista_host"] = mask_sensitive_ip(str(health_data["omnivista_host"]))

    return ApiResponse(
        success=is_healthy,
        message=health_data.get("message", "Verificación completada"),
        data=health_data
    )


@router.get(
    "/api/v1/system/version",
    response_model=ApiResponse[Any],
    summary="Versión del NMS OmniVista 2500",
    description="Obtiene información detallada de versión del sistema OmniVista NMS. Requiere autenticación.",
    dependencies=[Depends(verify_api_key)],
)
def get_system_version(
    service: OmniVistaService = Depends(get_ov_service)
):
    ver = service.get_system_version()
    if ver is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se pudo obtener información de versión de OmniVista 2500."
        )
    return ApiResponse(
        success=True,
        message="Información de versión obtenida",
        data=ver
    )
