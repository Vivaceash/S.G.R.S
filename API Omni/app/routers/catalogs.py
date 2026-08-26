from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.schemas.catalogs import AccessRoleProfileResponse, DeviceOptionsResponse

router = APIRouter(
    prefix="/api/v1/catalogs",
    tags=["Catálogos y Opciones (Para Frontend)"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "/access-role-profiles",
    response_model=ApiResponse[AccessRoleProfileResponse],
    summary="Listar Redes y Perfiles de Acceso (AccessRoleProfile)",
    description="Devuelve la lista de nombres de SSIDs y perfiles de red disponibles para poblar el dropdown en el formulario de alta.",
)
def get_access_role_profiles(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        profiles = service.get_access_role_profiles()
        return ApiResponse(
            success=True,
            message="Perfiles de acceso a red obtenidos correctamente",
            data=AccessRoleProfileResponse(
                profiles=profiles,
                total=len(profiles)
            )
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/device-options",
    response_model=ApiResponse[DeviceOptionsResponse],
    summary="Opciones de Categorías y Sistemas Operativos para Dispositivos",
    description="Devuelve los listados de categorías, familias y sistemas operativos para los dropdowns de Company Property.",
)
def get_device_options(
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        options = service.get_device_options()
        return ApiResponse(
            success=True,
            message="Opciones de dispositivos obtenidas",
            data=DeviceOptionsResponse(**options)
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
