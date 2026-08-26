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
