from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.schemas.catalogs import InfrastructureStatsResponse

router = APIRouter(
    prefix="/api/v1/monitoring",
    tags=["Monitoreo y Métricas de Red"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "/infrastructure-stats",
    response_model=ApiResponse[InfrastructureStatsResponse],
    summary="Resumen de Métricas de Infraestructura",
    description="Devuelve el conteo de APs, switches, dispositivos totales, cuentas de empleados y MACs registradas.",
)
def get_infrastructure_stats(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        stats = service.get_infrastructure_stats()
        return ApiResponse(
            success=True,
            message="Estadísticas de infraestructura obtenidas",
            data=InfrastructureStatsResponse(**stats)
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/devices",
    response_model=ApiResponse[List[Dict[str, Any]]],
    summary="Inventario de Equipos de Red (Switches y APs)",
    description="Lista todos los dispositivos administrados en OmniVista con su IP, MAC, modelo y estado operacional.",
)
def get_devices(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        devices = service.get_devices()
        return ApiResponse(
            success=True,
            message="Inventario de dispositivos obtenido",
            data=devices
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/online-devices",
    response_model=ApiResponse[List[Dict[str, Any]]],
    summary="Dispositivos Actualmente Conectados y Online",
    description="Lista los dispositivos de Company Property autenticados en vivo en los APs y switches de la red.",
)
def get_online_devices(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        online = service.get_online_devices()
        return ApiResponse(
            success=True,
            message="Dispositivos online obtenidos",
            data=online
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
