from typing import List, Optional, Any, Dict
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
    otherDevicesCount: int = Field(0, description="Otros equipos de infraestructura")
    registeredEmployeesCount: int = Field(0, description="Total de cuentas de empleados registradas en UPAM")
    registeredMacsCount: int = Field(0, description="Total de dispositivos/MACs registradas en Company Property")


class VlanItemResponse(BaseModel):
    vlanId: Optional[Any] = Field(None, description="Identificador numérico de la VLAN")
    vlanName: Optional[str] = Field(None, description="Nombre de la VLAN")
    vlanType: Optional[str] = Field(None, description="Tipo de VLAN")
    description: Optional[str] = Field(None, description="Descripción")


class VlanCatalogResponse(BaseModel):
    vlans: List[Dict[str, Any]] = Field(default_factory=list, description="Lista de VLANs configuradas")
    total: int = Field(0, description="Total de VLANs")
