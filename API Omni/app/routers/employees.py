from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeUpdate,
    EmployeeResponse,
    EmployeeStatusSwitch,
)

router = APIRouter(
    prefix="/api/v1/employees",
    tags=["Cuentas de Empleados (Employee Accounts)"],
    dependencies=[Depends(verify_api_key)]
)


@router.get(
    "",
    response_model=ApiResponse[PaginatedResponse[EmployeeResponse]],
    summary="Listar Cuentas de Empleados",
    description="Obtiene la lista de cuentas de empleados con soporte de paginación y búsqueda por nombre, usuario, correo, departamento o red.",
)
def list_employees(
    page: int = Query(1, ge=1, description="Número de página"),
    page_size: int = Query(50, ge=1, le=500, description="Cantidad de registros por página"),
    search: Optional[str] = Query(None, description="Término de búsqueda"),
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.get_employee_accounts(page=page, page_size=page_size, search=search)
        return ApiResponse(
            success=True,
            message="Cuentas de empleados obtenidas correctamente",
            data=PaginatedResponse[EmployeeResponse](**result)
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/{username}",
    response_model=ApiResponse[EmployeeResponse],
    summary="Obtener Detalle de Cuenta",
    description="Consulta la información detallada de una cuenta de empleado por su nombre de usuario.",
)
def get_employee(
    username: str,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        employee = service.get_employee_by_username(username)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No se encontró la cuenta de empleado '{username}'."
            )
        return ApiResponse(
            success=True,
            message="Detalle de cuenta obtenido",
            data=EmployeeResponse(**employee)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_201_CREATED,
    summary="Dar de Alta Cuenta de Empleado (Paso 1)",
    description="Registra una nueva cuenta de acceso en OmniVista UPAM.",
)
def create_employee(
    data: EmployeeCreate,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.create_employee_account(data)
        return ApiResponse(
            success=True,
            message=f"Cuenta de empleado '{data.username}' creada exitosamente en OmniVista.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put(
    "/{username}",
    response_model=ApiResponse[dict],
    summary="Modificar Cuenta de Empleado",
    description="Actualiza los datos (correo, teléfono, departamento, red o contraseña) de un empleado existente.",
)
def update_employee(
    username: str,
    data: EmployeeUpdate,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.update_employee_account(username, data)
        return ApiResponse(
            success=True,
            message=f"Cuenta '{username}' actualizada exitosamente.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete(
    "/{username}",
    response_model=ApiResponse[dict],
    summary="Dar de Baja / Eliminar Cuenta de Empleado",
    description="Elimina definitivamente la cuenta de empleado de OmniVista UPAM.",
)
def delete_employee(
    username: str,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.delete_employee_account(username)
        return ApiResponse(
            success=True,
            message=f"Cuenta '{username}' eliminada exitosamente de OmniVista.",
            data=result
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.patch(
    "/{username}/status",
    response_model=ApiResponse[dict],
    summary="Activar o Desactivar Cuenta",
    description="Cambia el estado de una cuenta entre Activo (1) e Inactivo (0).",
)
def switch_employee_status(
    username: str,
    status_data: EmployeeStatusSwitch,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.switch_employee_status(username, status_data.status)
        estado_str = "activada" if status_data.status == 1 else "desactivada"
        return ApiResponse(
            success=True,
            message=f"Cuenta '{username}' {estado_str} exitosamente.",
            data=result
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
