from typing import Optional
from pydantic import BaseModel, Field, model_validator, field_validator
from app.schemas.employee import EmployeeResponse
from app.schemas.company_property import CompanyPropertyResponse, clean_mac_address


class CompleteEnrollmentRequest(BaseModel):
    # Paso 1: Datos de Cuenta de Empleado
    username: str = Field(..., min_length=2, max_length=64, description="Nombre de usuario (ej. primer_nombre.apellido)")
    password: str = Field(..., min_length=4, max_length=64, description="Contraseña de acceso a la red")
    repeatPassword: str = Field(..., min_length=4, max_length=64, description="Confirmar contraseña")
    fullName: Optional[str] = Field(None, max_length=128, description="Nombre completo")
    telephone: Optional[str] = Field(None, max_length=32, description="Teléfono")
    email: Optional[str] = Field(None, max_length=128, description="Correo electrónico")
    department: Optional[str] = Field(None, max_length=128, description="Departamento")
    position: Optional[str] = Field(None, max_length=128, description="Puesto o cargo")
    description: Optional[str] = Field(None, max_length=256, description="Descripción o justificación")
    accessRoleProfile: Optional[str] = Field(None, description="Red / SSID de acceso asignada (ej. __SSID-Ehecatl)")
    policyList: Optional[str] = Field("", description="Lista de políticas")

    # Paso 2: Datos de Dispositivo / MAC
    deviceMac: str = Field(..., description="Dirección MAC del dispositivo (ej. 0C:71:65:7A:56:45)")
    deviceName: Optional[str] = Field(None, max_length=128, description="Nombre del dispositivo (si se omite, se usa el username)")
    deviceCategory: Optional[str] = Field("Mobile", description="Categoría del dispositivo")
    deviceFamily: Optional[str] = Field("Others", description="Familia del dispositivo")
    deviceOS: Optional[str] = Field("Android", description="Sistema Operativo")
    enableDeviceSpecificPSK: Optional[str] = Field("Disabled", description="Habilitar PSK específico")

    @field_validator("deviceMac")
    @classmethod
    def validate_mac(cls, v: str) -> str:
        return clean_mac_address(v)

    @model_validator(mode="after")
    def verify_passwords_match(self):
        if self.password != self.repeatPassword:
            raise ValueError("Las contraseñas no coinciden. Verifica los campos 'password' y 'repeatPassword'.")
        # Si no se pasó deviceName, asignar por defecto el username
        if not self.deviceName:
            self.deviceName = self.username
        return self


class CompleteEnrollmentResponse(BaseModel):
    employeeCreated: bool = Field(True)
    deviceMacRegistered: bool = Field(True)
    username: str = Field(...)
    deviceMac: str = Field(...)
    accessRoleProfile: Optional[str] = Field(None)
    details: Optional[dict] = Field(None)
