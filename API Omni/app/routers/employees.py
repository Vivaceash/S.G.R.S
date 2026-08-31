import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.employee import EmployeeResponse

router = APIRouter(
    prefix="/api/v1/employees",
    tags=["Cuentas y Empleados (UPAM)"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "",
    response_model=ApiResponse[PaginatedResponse[EmployeeResponse]],
    summary="Listar Cuentas de Empleados",
    description="Consulta el directorio de cuentas de empleados registradas en OmniVista UPAM con soporte de paginación y búsqueda por texto (nombre, usuario, correo, departamento o red).",
)
def list_employees(
    page: int = Query(1, ge=1, description="Número de página a consultar"),
    page_size: int = Query(50, ge=1, le=500, description="Cantidad de registros por página"),
    search: Optional[str] = Query(None, max_length=100, description="Filtro de búsqueda por nombre, usuario, correo, departamento o SSID (máximo 100 caracteres)"),
    service: OmniVistaService = Depends(get_ov_service)
):
    result = service.get_employee_accounts(page=page, page_size=page_size, search=search)
    return ApiResponse(
        success=True,
        message="Cuentas de empleados obtenidas correctamente",
        data=PaginatedResponse[EmployeeResponse](**result)
    )


@router.get(
    "/{username}",
    response_model=ApiResponse[EmployeeResponse],
    summary="Obtener Detalle de Cuenta",
    description="Consulta la información detallada de una cuenta de usuario específica en OmniVista por su nombre de usuario.",
)
def get_employee(
    username: str = Path(..., min_length=1, max_length=64, description="Nombre de usuario de red"),
    service: OmniVistaService = Depends(get_ov_service)
):
    clean_user = username.strip()
    if not re.fullmatch(r"^[a-zA-Z0-9._\-@]+$", clean_user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nombre de usuario contiene caracteres no permitidos."
        )

    employee = service.get_employee_by_username(clean_user)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró la cuenta de empleado '{clean_user}'."
        )
    return ApiResponse(
        success=True,
        message="Detalle de cuenta obtenido correctamente",
        data=EmployeeResponse(**employee)
    )
