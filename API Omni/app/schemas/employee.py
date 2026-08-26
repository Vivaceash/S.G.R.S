from typing import Optional, List, Any
from pydantic import BaseModel, Field, model_validator


class EmployeeBase(BaseModel):
    username: str = Field(..., min_length=2, max_length=64, description="Nombre de usuario para acceso a la red (ej. juan.perez)")
    fullName: Optional[str] = Field(None, max_length=128, description="Nombre completo del empleado")
    telephone: Optional[str] = Field(None, max_length=32, description="Número telefónico")
    email: Optional[str] = Field(None, max_length=128, description="Correo electrónico")
    department: Optional[str] = Field(None, max_length=128, description="Departamento o área (ej. Urgencias, Sistemas)")
    position: Optional[str] = Field(None, max_length=128, description="Puesto o cargo laboral (ej. Medico Especialista C)")
    description: Optional[str] = Field(None, max_length=256, description="Descripción o motivo del alta (ej. Solicitud por ticket #1234)")
    accessRoleProfile: Optional[str] = Field(None, description="Red / SSID o perfil de acceso asignado (ej. __SSID-Ehecatl)")
    policyList: Optional[str] = Field("", description="Lista de políticas asociadas")
    status: Optional[int] = Field(1, description="Estado de la cuenta: 1 = Activo, 0 = Inactivo")


class EmployeeCreate(EmployeeBase):
    password: str = Field(..., min_length=4, max_length=64, description="Contraseña de acceso para el usuario")
    repeatPassword: str = Field(..., min_length=4, max_length=64, description="Repetir la contraseña (debe coincidir exactamente)")

    @model_validator(mode="after")
    def verify_passwords_match(self):
        if self.password != self.repeatPassword:
            raise ValueError("Las contraseñas no coinciden. Verifica los campos 'password' y 'repeatPassword'.")
        return self


class EmployeeUpdate(BaseModel):
    password: Optional[str] = Field(None, min_length=4, max_length=64, description="Nueva contraseña (opcional)")
    repeatPassword: Optional[str] = Field(None, min_length=4, max_length=64, description="Confirmación de nueva contraseña")
    fullName: Optional[str] = Field(None, max_length=128)
    telephone: Optional[str] = Field(None, max_length=32)
    email: Optional[str] = Field(None, max_length=128)
    department: Optional[str] = Field(None, max_length=128)
    position: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = Field(None, max_length=256)
    accessRoleProfile: Optional[str] = Field(None)
    policyList: Optional[str] = Field(None)
    status: Optional[int] = Field(None)

    @model_validator(mode="after")
    def verify_passwords_match(self):
        if self.password is not None or self.repeatPassword is not None:
            if self.password != self.repeatPassword:
                raise ValueError("Las contraseñas no coinciden. Verifica los campos 'password' y 'repeatPassword'.")
        return self


class EmployeeStatusSwitch(BaseModel):
    username: str = Field(..., description="Nombre de usuario a modificar")
    status: int = Field(..., ge=0, le=1, description="Nuevo estado: 1 = Activar, 0 = Desactivar")


class EmployeeResponse(EmployeeBase):
    id: Optional[int] = Field(None, description="Identificador único numérico en OmniVista")
    dateOfEffective: Optional[Any] = Field(None, description="Fecha de vigencia / timestamp de creación")
    checked: Optional[bool] = Field(False)
