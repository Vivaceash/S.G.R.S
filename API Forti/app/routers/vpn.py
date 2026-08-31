from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse

router = APIRouter(
    prefix="/vpn",
    tags=["VPN (IPsec y SSL-VPN)"],
    dependencies=[Depends(verify_api_key)],
)


class IPsecTunnelItem(BaseModel):
    name: str = Field(..., description="Nombre del túnel VPN IPsec")
    comments: Optional[str] = Field(None, description="Comentarios")
    status: Optional[str] = Field(None, description="Estado del túnel (up, down)")
    remote_gateway: Optional[str] = Field(None, description="IP de la pasarela remota")
    incoming_bytes: Optional[int] = Field(None, description="Bytes entrantes")
    outgoing_bytes: Optional[int] = Field(None, description="Bytes salientes")
    raw_tunnel: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Datos crudos")


class SSLVPNUserSession(BaseModel):
    user_name: Optional[str] = Field(None, description="Nombre de usuario conectado")
    ip: Optional[str] = Field(None, description="IP asignada al túnel SSL-VPN")
    remote_host: Optional[str] = Field(None, description="IP pública origen del usuario")
    duration: Optional[int] = Field(None, description="Segundos conectado")
    bytes_sent: Optional[int] = Field(None, description="Bytes enviados")
    bytes_received: Optional[int] = Field(None, description="Bytes recibidos")
    raw_session: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Datos crudos")


@router.get(
    "/ipsec",
    response_model=BaseResponse[List[IPsecTunnelItem]],
    summary="Consultar túneles VPN IPsec y su estado",
)
async def get_vpn_ipsec(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
    raw = await fortios_client.get_vpn_ipsec(vdom=vdom)
    results = raw.get("results", [])
    tunnels_raw = results if isinstance(results, list) else (results.get("tunnels", []) if isinstance(results, dict) else [])

    tunnels: List[IPsecTunnelItem] = []
    for item in tunnels_raw:
        if isinstance(item, dict):
            tunnels.append(
                IPsecTunnelItem(
                    name=item.get("name") or item.get("proxyid", "ipsec_tunnel"),
                    comments=item.get("comments"),
                    status=item.get("status") or ("up" if item.get("incoming_bytes", 0) > 0 else "down"),
                    remote_gateway=item.get("remote_gateway") or item.get("rgwy"),
                    incoming_bytes=item.get("incoming_bytes"),
                    outgoing_bytes=item.get("outgoing_bytes"),
                    raw_tunnel=item,
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(tunnels)} túneles IPsec.",
        data=tunnels,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/ssl-sessions",
    response_model=BaseResponse[List[SSLVPNUserSession]],
    summary="Listar usuarios y sesiones activas en SSL-VPN",
)
async def get_vpn_ssl_sessions(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
    raw = await fortios_client.get_vpn_ssl_sessions(vdom=vdom)
    results = raw.get("results", [])
    sessions_raw = results if isinstance(results, list) else (results.get("sessions", []) if isinstance(results, dict) else [])

    sessions: List[SSLVPNUserSession] = []
    for item in sessions_raw:
        if isinstance(item, dict):
            sessions.append(
                SSLVPNUserSession(
                    user_name=item.get("user_name") or item.get("user"),
                    ip=item.get("ip") or item.get("tunnel_ip"),
                    remote_host=item.get("remote_host") or item.get("srcip"),
                    duration=item.get("duration"),
                    bytes_sent=item.get("bytes_sent") or item.get("sent"),
                    bytes_received=item.get("bytes_received") or item.get("rcvd"),
                    raw_session=item,
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(sessions)} usuarios SSL-VPN conectados.",
        data=sessions,
        vdom=raw.get("vdom") or vdom,
    )
