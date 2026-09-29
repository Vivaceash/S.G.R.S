from typing import List, Optional, Union
from pydantic import BaseModel, Field


class DeviceItem(BaseModel):
    mac: Optional[str] = Field(None, description="Dirección MAC del dispositivo")
    ip: Optional[str] = Field(None, description="Dirección IPv4/IPv6 asignada")
    hostname: Optional[str] = Field(None, description="Nombre de host o nombre asignado")
    hardware_vendor: Optional[str] = Field(None, description="Fabricante del hardware (ej. Apple, Samsung, Dell, Cisco)")
    hardware_family: Optional[str] = Field(None, description="Familia de dispositivo (ej. iPhone, PC, Printer, Router)")
    os_name: Optional[str] = Field(None, description="Nombre del Sistema Operativo detectado (ej. iOS, Windows 11, Android, Linux)")
    os_version: Optional[str] = Field(None, description="Versión específica del SO")
    interface: Optional[str] = Field(None, description="Interfaz de red a la que está conectado (ej. port1, lan, wifi)")
    is_online: Optional[bool] = Field(None, description="Si el dispositivo se encuentra activo actualmente")
    is_reserved: bool = Field(False, description="La IP y MAC corresponden a una reserva DHCP configurada")
    reserved_ip: Optional[str] = Field(None, description="IP de la reserva DHCP configurada")
    ip_source: Optional[str] = Field(None, description="Fuente del cotejo de IP; unconfirmed si aún no se pudo resolver")
    last_seen: Optional[Union[str, int, float]] = Field(None, description="Última vez visto o timestamp")
    device_type: Optional[str] = Field(None, description="Categoría de dispositivo (ej. Phone, Computer, IoT, Server)")
    user: Optional[str] = Field(None, description="Usuario identificado o no autenticado asociado al dispositivo")
    serial: Optional[str] = Field(None, description="Número de serie del hardware")
    detected_device: Optional[str] = Field(None, description="Dispositivo detectado o nombre de host reportado")
    fortigate: Optional[str] = Field(None, description="Nombre o VDOM del FortiGate de procedencia")


class DeviceListSummary(BaseModel):
    total_inventory: int = Field(..., description="Total de dispositivos registrados en el inventario histórico de FortiOS")
    online_devices: int = Field(..., description="Cantidad de dispositivos activos / conectados actualmente")
    offline_devices: int = Field(..., description="Cantidad de dispositivos desconectados / históricos en caché")
    returned_count: int = Field(..., description="Cantidad de dispositivos incluidos en esta respuesta tras aplicar filtros")
    total_devices: int = Field(..., description="Total de dispositivos en el inventario de FortiOS (retrocompatibilidad)")
    devices: List[DeviceItem] = Field(default_factory=list, description="Lista detallada de dispositivos")
