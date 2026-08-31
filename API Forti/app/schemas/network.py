from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class DHCPLeaseItem(BaseModel):
    ip: Optional[str] = Field(None, description="Dirección IP asignada por DHCP")
    mac: Optional[str] = Field(None, description="Dirección MAC del cliente")
    hostname: Optional[str] = Field(None, description="Nombre de host del cliente DHCP")
    interface: Optional[str] = Field(None, description="Interfaz o servidor DHCP")
    expires: Optional[Union[str, int]] = Field(None, description="Tiempo restante de la concesión (lease)")
    status: Optional[str] = Field(None, description="Estado del lease (ej. bound, reserved)")
    raw_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Datos crudos de FortiOS")


class ARPEntry(BaseModel):
    ip: Optional[str] = Field(None, description="Dirección IP")
    mac: Optional[str] = Field(None, description="Dirección MAC vinculada")
    interface: Optional[str] = Field(None, description="Interfaz de red")
    state: Optional[Union[str, int]] = Field(None, description="Estado o edad de la entrada ARP")


class InterfaceItem(BaseModel):
    name: str = Field(..., description="Nombre de la interfaz (ej. port1, wan1, lan)")
    link_up: Optional[bool] = Field(None, description="Si el enlace físico está arriba (UP)")
    ip: Optional[Union[str, int]] = Field(None, description="Dirección IP y máscara configuradas")
    speed: Optional[Union[str, float, int]] = Field(None, description="Velocidad y modo dúplex")
    tx_bytes: Optional[int] = Field(None, description="Bytes transmitidos")
    rx_bytes: Optional[int] = Field(None, description="Bytes recibidos")
    tx_packets: Optional[int] = Field(None, description="Paquetes transmitidos")
    rx_packets: Optional[int] = Field(None, description="Paquetes recibidos")
    tx_errors: Optional[int] = Field(None, description="Errores de transmisión")
    rx_errors: Optional[int] = Field(None, description="Errores de recepción")


class DhcpPoolScope(BaseModel):
    id: int = Field(..., description="Identificador único del servidor DHCP en FortiOS")
    interface: str = Field(..., description="Nombre de la interfaz o VLAN asociada")
    default_gateway: Optional[str] = Field(None, description="Gateway predeterminado configurado")
    netmask: Optional[str] = Field(None, description="Máscara de red de la subred")
    ip_ranges: List[str] = Field(default_factory=list, description="Rangos IP dinámicos configurados en el pool")
    capacity: int = Field(..., description="Cantidad total de direcciones IP asignables en el pool")
    active_leases: int = Field(..., description="Cantidad de concesiones activas entregadas a clientes")
    available_ips: int = Field(..., description="Direcciones IP libres restantes en el pool")
    utilization_percent: float = Field(..., description="Porcentaje de saturación / uso del pool (0-100%)")
    status: str = Field(..., description="Estado de saturación: 'normal' (<75%), 'warning' (75-85%), 'critical' (>85%)")
    lease_time_seconds: Optional[int] = Field(None, description="Tiempo de concesión en segundos")


class DhcpPoolSummary(BaseModel):
    total_pools: int = Field(..., description="Total de servidores/scopes DHCP configurados")
    total_capacity: int = Field(..., description="Capacidad total global de direcciones IP en todos los pools")
    total_active_leases: int = Field(..., description="Total de concesiones entregadas y activas actualmente")
    total_available_ips: int = Field(..., description="Total de direcciones IP libres en la red")
    global_saturation_percent: float = Field(..., description="Porcentaje de saturación global del direccionamiento")
    critical_pools_count: int = Field(..., description="Cantidad de pools con saturación crítica (>85%)")
    warning_pools_count: int = Field(..., description="Cantidad de pools con saturación de advertencia (75-85%)")
    pools: List[DhcpPoolScope] = Field(default_factory=list, description="Desglose detallado por pool / VLAN")
