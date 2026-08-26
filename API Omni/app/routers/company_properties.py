from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.company_property import CompanyPropertyResponse, clean_mac_address

router = APIRouter(
    prefix="/api/v1/company-properties",
    tags=["Dispositivos y MACs (Company Property)"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "",
    response_model=ApiResponse[PaginatedResponse[CompanyPropertyResponse]],
    summary="Listar Dispositivos y MACs Registradas",
    description="Consulta todos los dispositivos y direcciones MAC autorizadas en Company Property con opciones de búsqueda y paginación.",
)
def list_company_properties(
    page: int = Query(1, ge=1, description="Número de página"),
    page_size: int = Query(50, ge=1, le=500, description="Cantidad de registros por página"),
    search: Optional[str] = Query(None, description="Buscar por MAC, nombre de equipo, cuenta de usuario o SSID"),
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.get_company_properties(page=page, page_size=page_size, search=search)
        return ApiResponse(
            success=True,
            message="Dispositivos obtenidos correctamente",
            data=PaginatedResponse[CompanyPropertyResponse](**result)
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/{device_mac}",
    response_model=ApiResponse[CompanyPropertyResponse],
    summary="Consultar Dispositivo por Dirección MAC",
    description="Obtiene el detalle, cuenta asociada, perfil de red y último punto de acceso de una dirección MAC específica.",
)
def get_company_property(
    device_mac: str,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        clean_mac = clean_mac_address(device_mac)
        prop = service.get_company_property_by_mac(clean_mac)
        if not prop:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No se encontró el dispositivo con MAC '{device_mac}' en Company Property."
            )
        return ApiResponse(
            success=True,
            message="Detalle de dispositivo obtenido",
            data=CompanyPropertyResponse(**prop)
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
