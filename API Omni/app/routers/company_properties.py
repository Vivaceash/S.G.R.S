from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.company_property import (
    CompanyPropertyCreate,
    CompanyPropertyUpdate,
    CompanyPropertyResponse,
    clean_mac_address,
)

router = APIRouter(
    prefix="/api/v1/company-properties",
    tags=["Dispositivos y MACs (Company Property)"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "",
    response_model=ApiResponse[PaginatedResponse[CompanyPropertyResponse]],
    summary="Listar Dispositivos y MACs Registradas",
    description="Consulta todos los dispositivos y direcciones MAC registradas en Company Property con búsqueda y paginación.",
)
def list_company_properties(
    page: int = Query(1, ge=1, description="Número de página"),
    page_size: int = Query(50, ge=1, le=500, description="Cantidad de registros por página"),
    search: Optional[str] = Query(None, description="Buscar por MAC, nombre de dispositivo, cuenta o SSID"),
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
    summary="Obtener Detalle de Dispositivo por MAC",
    description="Consulta la información y estado de una dirección MAC específica.",
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
                detail=f"No se encontró el dispositivo con MAC '{device_mac}'."
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


@router.post(
    "",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_201_CREATED,
    summary="Registrar Dispositivo / MAC (Paso 2)",
    description="Registra una nueva dirección MAC en Company Property vinculándola a una cuenta de usuario y red.",
)
def create_company_property(
    data: CompanyPropertyCreate,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.add_company_property(data)
        return ApiResponse(
            success=True,
            message=f"Dispositivo con MAC '{data.deviceMac}' registrado exitosamente en Company Property.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put(
    "/{device_mac}",
    response_model=ApiResponse[dict],
    summary="Modificar Dispositivo / MAC",
    description="Actualiza la cuenta asociada, perfil de red, categoría o sistema operativo de una MAC registrada.",
)
def update_company_property(
    device_mac: str,
    data: CompanyPropertyUpdate,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        clean_mac = clean_mac_address(device_mac)
        result = service.update_company_property(clean_mac, data)
        return ApiResponse(
            success=True,
            message=f"Dispositivo con MAC '{device_mac}' actualizado exitosamente.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete(
    "/{device_mac}",
    response_model=ApiResponse[dict],
    summary="Dar de Baja / Eliminar Dispositivo / MAC",
    description="Elimina la dirección MAC de Company Property revocando su acceso autorizado.",
)
def delete_company_property(
    device_mac: str,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        clean_mac = clean_mac_address(device_mac)
        result = service.delete_company_property(clean_mac)
        return ApiResponse(
            success=True,
            message=f"Dispositivo con MAC '{device_mac}' eliminado exitosamente de OmniVista.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
