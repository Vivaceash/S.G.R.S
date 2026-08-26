from typing import List, Optional
from pydantic import BaseModel, Field


class AccessRoleProfileResponse(BaseModel):
    profiles: List[str] = Field(default_factory=list, description="Lista de nombres de perfiles de acceso a red / SSIDs")
    total: int = Field(0, description="Total de perfiles disponibles")


class DeviceDropdownOption(BaseModel):
    label: str
    value: str


class DeviceOptionsResponse(BaseModel):
    categories: List[DeviceDropdownOption] = Field(default_factory=list)
    families: List[DeviceDropdownOption] = Field(default_factory=list)
    operating_systems: List[DeviceDropdownOption] = Field(default_factory=list)


class InfrastructureStatsResponse(BaseModel):
    totalDevices: int = Field(0, description="Total de equipos de red en OmniVista")
    accessPointsCount: int = Field(0, description="Total de Access Points")
    switchesCount: int = Field(0, description="Total de Switches")
    otherDevicesCount: int = Field(0, description="Otros equipos")
    registeredEmployeesCount: int = Field(0, description="Total de cuentas de empleados registradas")
    registeredMacsCount: int = Field(0, description="Total de dispositivos/MACs registradas en Company Property")
