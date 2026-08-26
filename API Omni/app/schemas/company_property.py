import re
from typing import Optional, Any, List
from pydantic import BaseModel, Field, field_validator


def clean_mac_address(value: str) -> str:
    """Normaliza y valida la dirección MAC al formato esperado por OmniVista (ej. 0C71657A5645)"""
    if not value:
        raise ValueError("La dirección MAC no puede estar vacía.")
    
    # Remover dos puntos, guiones, puntos y espacios
    clean = re.sub(r"[:\-\.\s]", "", value.strip()).upper()
    
    # Validar formato hexadecimal de 12 caracteres
    if not re.fullmatch(r"^[0-9A-F]{12}$", clean):
        raise ValueError(
            f"Dirección MAC inválida: '{value}'. Debe ser un formato MAC válido (ej. 0C:71:65:7A:56:45 o 0C71657A5645)."
        )
    return clean


class CompanyPropertyBase(BaseModel):
    deviceMac: str = Field(..., description="Dirección MAC del dispositivo (ej. 0C:71:65:7A:56:45 o 0C71657A5645)")
    deviceName: Optional[str] = Field(None, max_length=128, description="Nombre descriptivo del dispositivo (ej. israel.musito o Laptop-Dell)")
    employeeAccount: Optional[str] = Field(None, max_length=64, description="Usuario de la cuenta de empleado asociada")
    deviceCategory: Optional[str] = Field("Mobile", description="Categoría: Mobile, Computer, Printer, Others, etc.")
    deviceFamily: Optional[str] = Field("Others", description="Familia: Android, Apple iOS, Windows, Others, etc.")
    deviceOS: Optional[str] = Field("Android", description="Sistema Operativo: Android, iOS, Windows, macOS, etc.")
    enableDeviceSpecificPSK: Optional[str] = Field("Disabled", description="Habilitar PSK específico: Disabled o Enabled")
    accessRoleProfile: Optional[str] = Field(None, description="Red / Perfil de acceso asignado (ej. __SSID-Ehecatl)")
    policyList: Optional[str] = Field("", description="Lista de políticas")
    description: Optional[str] = Field(None, max_length=256)

    @field_validator("deviceMac")
    @classmethod
    def validate_and_format_mac(cls, v: str) -> str:
        return clean_mac_address(v)


class CompanyPropertyCreate(CompanyPropertyBase):
    pass


class CompanyPropertyUpdate(BaseModel):
    deviceName: Optional[str] = Field(None, max_length=128)
    employeeAccount: Optional[str] = Field(None, max_length=64)
    deviceCategory: Optional[str] = Field(None)
    deviceFamily: Optional[str] = Field(None)
    deviceOS: Optional[str] = Field(None)
    enableDeviceSpecificPSK: Optional[str] = Field(None)
    accessRoleProfile: Optional[str] = Field(None)
    policyList: Optional[str] = Field(None)
    description: Optional[str] = Field(None)


class CompanyPropertyResponse(CompanyPropertyBase):
    id: Optional[int] = Field(None, description="ID interno en OmniVista")
    account: Optional[str] = Field(None, description="Cuenta asociada")
    status: Optional[str] = Field("Offline", description="Estado de conexión del dispositivo: Online / Offline")
    activeStatus: Optional[str] = Field("Actived", description="Estado de registro: Actived / Inactived")
    lastAuthenticationTime: Optional[Any] = Field(None, description="Última fecha y hora de autenticación")
    lastAccessDeviceName: Optional[str] = Field(None, description="Nombre del AP o Switch donde se conectó por última vez")
    lastAccessDeviceSSID: Optional[str] = Field(None, description="SSID al que se conectó por última vez")
    lastAccessLocation: Optional[str] = Field(None, description="Ubicación / Puerto del último acceso")
