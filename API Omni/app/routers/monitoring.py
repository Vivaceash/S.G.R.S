import ipaddress
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.schemas.catalogs import InfrastructureStatsResponse

router = APIRouter(
    prefix="/api/v1/monitoring",
    tags=["Monitoreo e Infraestructura"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "/infrastructure-stats",
    response_model=ApiResponse[InfrastructureStatsResponse],
    summary="Resumen Métrico de Infraestructura",
    description="Devuelve el conteo consolidado de Access Points, Switches, otros equipos, cuentas de empleados y MACs registradas.",
)
def get_infrastructure_stats(
    service: OmniVistaService = Depends(get_ov_service)
):
    stats = service.get_infrastructure_stats()
    return ApiResponse(
        success=True,
        message="Estadísticas de infraestructura obtenidas",
        data=InfrastructureStatsResponse(**stats)
    )


@router.get(
    "/devices",
    response_model=ApiResponse[List[Dict[str, Any]]],
    summary="Inventario de Equipos de Red (Switches y APs)",
    description="Lista todos los dispositivos administrados en OmniVista con su IP, MAC, modelo de chasis y estado operacional.",
)
def get_devices(
    service: OmniVistaService = Depends(get_ov_service)
):
    devices = service.get_devices()
    return ApiResponse(
        success=True,
        message="Inventario de dispositivos obtenido",
        data=devices
    )


@router.get(
    "/devices/{ip_address}",
    response_model=ApiResponse[Dict[str, Any]],
    summary="Consultar Equipo de Red por IP",
    description="Busca la información detallada de un switch o AP por su dirección IP de gestión.",
)
def get_device_by_ip(
    ip_address: str,
    service: OmniVistaService = Depends(get_ov_service)
):
    clean_ip = ip_address.strip()
    try:
        ipaddress.ip_address(clean_ip)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Dirección IP no válida: '{clean_ip}'. Debe tener formato IPv4 o IPv6 válido."
        )

    device = service.get_device_by_ip(clean_ip)
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún equipo de red con la IP '{clean_ip}'."
        )
    return ApiResponse(
        success=True,
        message=f"Equipo con IP {clean_ip} encontrado",
        data=device
    )


@router.get(
    "/online-devices",
    response_model=ApiResponse[List[Dict[str, Any]]],
    summary="Dispositivos Actualmente Conectados (Sesiones Online)",
    description="Consulta los clientes y terminales de Company Property autenticados en vivo en los APs y switches de la red.",
)
def get_online_devices(
    service: OmniVistaService = Depends(get_ov_service)
):
    online = service.get_online_devices()
    return ApiResponse(
        success=True,
        message="Dispositivos online obtenidos",
        data=online
    )


@router.get(
    "/topology",
    response_model=ApiResponse[Any],
    summary="Topología de Red",
    description="Obtiene el mapa de topología y enlaces físicos/lógicos entre equipos de red.",
)
def get_topology(
    service: OmniVistaService = Depends(get_ov_service)
):
    topology = service.get_topology()
    return ApiResponse(
        success=True,
        message="Topología de red obtenida",
        data=topology
    )


@router.get(
    "/notifications",
    response_model=ApiResponse[Any],
    summary="Alarmas y Notificaciones Activas",
    description="Consulta las alarmas, trampas y eventos activos registrados en el NMS OmniVista 2500.",
)
def get_notifications(
    service: OmniVistaService = Depends(get_ov_service)
):
    notifications = service.get_notifications()
    return ApiResponse(
        success=True,
        message="Notificaciones y alarmas obtenidas",
        data=notifications
    )
