from typing import List, Optional
from pydantic import BaseModel, Field


class ActiveSessionItem(BaseModel):
    session_id: Optional[int] = Field(None, description="Identificador único de la sesión en el firewall")
    src_ip: Optional[str] = Field(None, description="Dirección IP de origen (cliente)")
    src_port: Optional[int] = Field(None, description="Puerto de origen")
    dst_ip: Optional[str] = Field(None, description="Dirección IP de destino (servidor/sitio web)")
    dst_port: Optional[int] = Field(None, description="Puerto de destino (ej. 80, 443, 53)")
    protocol_name: Optional[str] = Field(None, description="Nombre del protocolo (TCP, UDP, ICMP)")
    protocol_number: Optional[int] = Field(None, description="Número de protocolo IP (6=TCP, 17=UDP)")
    policy_id: Optional[int] = Field(None, description="ID de la regla de firewall aplicada")
    application: Optional[str] = Field(None, description="Aplicación o servicio detectado (ej. HTTPS, YouTube, Microsoft365)")
    bytes_sent: Optional[int] = Field(None, description="Bytes enviados desde origen a destino")
    bytes_received: Optional[int] = Field(None, description="Bytes recibidos desde destino a origen")
    duration: Optional[int] = Field(None, description="Duración de la sesión en segundos")
    expiry: Optional[int] = Field(None, description="Tiempo de expiración de sesión")


class WebActivityRecord(BaseModel):
    timestamp: Optional[str] = Field(None, description="Fecha y hora del registro")
    src_ip: Optional[str] = Field(None, description="IP origen")
    src_name: Optional[str] = Field(None, description="Nombre del dispositivo / usuario origen")
    dst_ip: Optional[str] = Field(None, description="IP destino")
    hostname: Optional[str] = Field(None, description="Nombre de dominio o URL del sitio web visitado")
    url: Optional[str] = Field(None, description="URL completa o ruta consultada")
    service: Optional[str] = Field(None, description="Servicio de red (ej. HTTPS, DNS)")
    action: Optional[str] = Field(None, description="Acción tomada por el firewall (allow, block, passthrough)")
    app_category: Optional[str] = Field(None, description="Categoría web o de aplicación (ej. Social Media, Streaming, Business)")
    sent_bytes: Optional[int] = Field(None, description="Bytes enviados")
    rcvd_bytes: Optional[int] = Field(None, description="Bytes recibidos")


class VisitedDestinationSummary(BaseModel):
    destination: str = Field(..., description="IP o dominio del destino")
    session_count: int = Field(..., description="Cantidad de sesiones activas hacia este destino")
    total_bytes: int = Field(default=0, description="Volumen total de datos transferidos")
    ports_used: List[int] = Field(default_factory=list, description="Puertos observados")
    client_ips: List[str] = Field(default_factory=list, description="Clientes internos que han conectado")
