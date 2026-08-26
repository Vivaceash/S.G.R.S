from typing import Optional, Any
from pydantic import BaseModel, Field


class EmployeeBase(BaseModel):
    username: str = Field(..., min_length=2, max_length=64, description="Nombre de usuario de red (ej. juan.perez)")
    fullName: Optional[str] = Field(None, max_length=128, description="Nombre completo del empleado")
    telephone: Optional[str] = Field(None, max_length=32, description="Número telefónico")
    email: Optional[str] = Field(None, max_length=128, description="Correo electrónico")
    department: Optional[str] = Field(None, max_length=128, description="Departamento o área (ej. Urgencias, Sistemas)")
    position: Optional[str] = Field(None, max_length=128, description="Puesto o cargo laboral (ej. Medico Especialista)")
    description: Optional[str] = Field(None, max_length=256, description="Descripción o notas de la cuenta")
    accessRoleProfile: Optional[str] = Field(None, description="Red / SSID o perfil de acceso asignado (ej. __SSID-Ehecatl)")
    policyList: Optional[str] = Field("", description="Lista de políticas asociadas")
    status: Optional[int] = Field(1, description="Estado de la cuenta: 1 = Activo, 0 = Inactivo")


class EmployeeResponse(EmployeeBase):
    id: Optional[int] = Field(None, description="Identificador único numérico en OmniVista UPAM")
    dateOfEffective: Optional[Any] = Field(None, description="Fecha de vigencia o creación")
    checked: Optional[bool] = Field(False, description="Indicador interno de OmniVista")
