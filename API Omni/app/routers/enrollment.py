from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import verify_api_key, get_ov_service
from app.services.omnivista_service import OmniVistaService
from app.schemas.common import ApiResponse
from app.schemas.enrollment import CompleteEnrollmentRequest, CompleteEnrollmentResponse

router = APIRouter(
    prefix="/api/v1/enrollment",
    tags=["Alta Unificada de Red (Enrollment)"],
    dependencies=[Depends(verify_api_key)]
)


@router.post(
    "/complete-user",
    response_model=ApiResponse[CompleteEnrollmentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Alta Completa de Usuario en la Red (Paso 1 + Paso 2)",
    description="Crea la cuenta de empleado (Employee Account) y registra su dirección MAC (Company Property) en un solo flujo.",
)
def enroll_complete_user(
    request: CompleteEnrollmentRequest,
    service: OmniVistaService = Depends(get_ov_service)
):
    try:
        result = service.enroll_complete_user(request)
        return ApiResponse(
            success=True,
            message=f"Alta exitosa. Usuario '{request.username}' y MAC '{request.deviceMac}' registrados correctamente en OmniVista.",
            data=result
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error durante el proceso de alta: {str(e)}")
