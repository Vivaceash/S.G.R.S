from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class FirewallPolicyItem(BaseModel):
    policyid: int = Field(..., description="ID numérico de la política de firewall")
    name: Optional[str] = Field(None, description="Nombre de la regla")
    srcintf: List[str] = Field(default_factory=list, description="Interfaces de origen")
    dstintf: List[str] = Field(default_factory=list, description="Interfaces de destino")
    srcaddr: List[str] = Field(default_factory=list, description="Objetos de dirección de origen")
    dstaddr: List[str] = Field(default_factory=list, description="Objetos de dirección de destino")
    action: Optional[str] = Field(None, description="Acción (accept, deny)")
    status: Optional[str] = Field(None, description="Estado de la regla (enable, disable)")
    service: List[str] = Field(default_factory=list, description="Servicios/protocolos permitidos (ej. ALL, HTTPS)")
    nat: Optional[str] = Field(None, description="Si NAT está habilitado (enable, disable)")
    schedule: Optional[str] = Field(None, description="Horario de aplicación de la regla (ej. always)")
    logtraffic: Optional[str] = Field(None, description="Modo de log (all, utm, disable)")
    comments: Optional[str] = Field(None, description="Comentarios de la política")


class FirewallAddressItem(BaseModel):
    name: str = Field(..., description="Nombre del objeto de dirección")
    type: Optional[str] = Field(None, description="Tipo de dirección (ipmask, iprange, fqdn, geography)")
    subnet: Optional[str] = Field(None, description="Subred IP y máscara (ej. 192.168.1.0 255.255.255.0)")
    fqdn: Optional[str] = Field(None, description="Nombre de dominio FQDN si aplica")
    start_ip: Optional[str] = Field(None, description="IP inicial si es rango")
    end_ip: Optional[str] = Field(None, description="IP final si es rango")
    comment: Optional[str] = Field(None, description="Comentario")


class FirewallAddressGroupItem(BaseModel):
    name: str = Field(..., description="Nombre del grupo de direcciones")
    members: List[str] = Field(default_factory=list, description="Nombres de los objetos de dirección miembros")
    comment: Optional[str] = Field(None, description="Comentario del grupo")
