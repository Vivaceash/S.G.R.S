from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.schemas.catalogs import AccessRoleProfileResponse, DeviceOptionsResponse, VlanCatalogResponse

router = APIRouter(
    prefix="/api/v1/catalogs",
    tags=["Catálogos y Redes"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "/access-role-profiles",
    response_model=ApiResponse[AccessRoleProfileResponse],
    summary="Listar Redes y Perfiles de Acceso (AccessRoleProfile / SSIDs)",
    description="Devuelve la lista de perfiles de red y SSIDs configurados en OmniVista para asignación de políticas de acceso.",
)
def get_access_role_profiles(
    service: OmniVistaService = Depends(get_ov_service)
):
    profiles = service.get_access_role_profiles()
    return ApiResponse(
        success=True,
        message="Perfiles de acceso a red obtenidos correctamente",
        data=AccessRoleProfileResponse(
            profiles=profiles,
            total=len(profiles)
        )
    )


@router.get(
    "/device-options",
    response_model=ApiResponse[DeviceOptionsResponse],
    summary="Opciones Estándar de Dispositivos y Sistemas Operativos",
    description="Devuelve las categorías, familias y sistemas operativos clasificados por el NMS OmniVista.",
)
def get_device_options(
    service: OmniVistaService = Depends(get_ov_service)
):
    options = service.get_device_options()
    return ApiResponse(
        success=True,
        message="Opciones de dispositivos obtenidas correctamente",
        data=DeviceOptionsResponse(**options)
    )


@router.get(
    "/vlans",
    response_model=ApiResponse[VlanCatalogResponse],
    summary="Catálogo de VLANs Configuradas",
    description="Consulta el inventario de VLANs y subredes disponibles en los conmutadores Alcatel gestionados.",
)
def get_vlans(
    service: OmniVistaService = Depends(get_ov_service)
):
    vlans = service.get_vlans()
    return ApiResponse(
        success=True,
        message="Catálogo de VLANs obtenido correctamente",
        data=VlanCatalogResponse(vlans=vlans, total=len(vlans))
    )
