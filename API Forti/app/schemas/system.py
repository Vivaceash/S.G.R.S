from typing import Optional
from pydantic import BaseModel, Field


class SystemStatusData(BaseModel):
    hostname: Optional[str] = Field(None, description="Nombre de host del FortiGate")
    serial: Optional[str] = Field(None, description="Número de serie del equipo")
    version: Optional[str] = Field(None, description="Versión de FortiOS instalada")
    build: Optional[int] = Field(None, description="Número de compilación (build)")
    firmware_version: Optional[str] = Field(None, description="Cadena completa de versión de firmware")
    uptime: Optional[int] = Field(None, description="Tiempo de actividad en segundos")
    uptime_human: Optional[str] = Field(None, description="Tiempo de actividad en formato legible")
    ha_mode: Optional[str] = Field(None, description="Modo de Alta Disponibilidad (standalone, active-passive, active-active)")
    vdom_enabled: Optional[bool] = Field(None, description="Si tiene VDOMs múltiples habilitados")


class SystemResourceUsage(BaseModel):
    cpu_percent: Optional[float] = Field(None, description="Porcentaje de uso actual de CPU (0-100%)")
    memory_percent: Optional[float] = Field(None, description="Porcentaje de uso actual de Memoria RAM (0-100%)")
    disk_percent: Optional[float] = Field(None, description="Porcentaje de uso del disco o almacenamiento")
    session_count: Optional[int] = Field(None, description="Número actual de sesiones concurrentes activas")
    session_limit: Optional[int] = Field(None, description="Límite máximo de sesiones soportadas")
