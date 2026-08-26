from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.network import ARPEntry, DHCPLeaseItem, InterfaceItem

router = APIRouter(
    prefix="/network",
    tags=["Red, DHCP e Interfaces"],
    dependencies=[Depends(verify_api_key)],
)


@router.get(
    "/dhcp-leases",
    response_model=BaseResponse[List[DHCPLeaseItem]],
    summary="Listar concesiones DHCP activas",
)
async def get_dhcp_leases(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    """
    Obtiene las asignaciones dinámicas de direcciones IP entregadas por el servidor DHCP del FortiGate.
    """
    raw = await fortios_client.get_dhcp_leases(vdom=vdom)
    results = raw.get("results", [])
    leases_raw = results if isinstance(results, list) else (results.get("leases", []) if isinstance(results, dict) else [])

    leases: List[DHCPLeaseItem] = []
    for item in leases_raw:
        if isinstance(item, dict):
            leases.append(
                DHCPLeaseItem(
                    ip=item.get("ip") or item.get("ipv4"),
                    mac=item.get("mac"),
                    hostname=item.get("hostname") or item.get("host"),
                    interface=item.get("interface") or item.get("intf"),
                    expires=str(item.get("expire", "")) or item.get("expiry"),
                    status=item.get("status", "bound"),
                    raw_data=item,
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(leases)} concesiones DHCP activas.",
        data=leases,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/arp-table",
    response_model=BaseResponse[List[ARPEntry]],
    summary="Consultar tabla de vecinos ARP",
)
async def get_arp_table(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    """
    Obtiene la tabla de resolución ARP (direcciones IP y MAC mapeadas a nivel de enlace de datos).
    """
    raw = await fortios_client.get_arp_table(vdom=vdom)
    results = raw.get("results", [])
    arp_raw = results if isinstance(results, list) else (results.get("arp", []) if isinstance(results, dict) else [])

    entries: List[ARPEntry] = []
    for item in arp_raw:
        if isinstance(item, dict):
            entries.append(
                ARPEntry(
                    ip=item.get("ip"),
                    mac=item.get("mac"),
                    interface=item.get("interface") or item.get("intf"),
                    state=item.get("state") or (f"age: {item['age']}" if "age" in item else None),
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(entries)} entradas de la tabla ARP.",
        data=entries,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/interfaces",
    response_model=BaseResponse[List[InterfaceItem]],
    summary="Consultar estado de las interfaces de red",
)
async def get_interfaces_status(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    """
    Obtiene el estado de las interfaces de red físicas y virtuales (link UP/DOWN, paquetes, bytes tx/rx).
    """
    raw = await fortios_client.get_interfaces_status(vdom=vdom)
    results = raw.get("results", {})

    items: List[InterfaceItem] = []

    # results puede ser un dict con nombres de interfaz como claves o una lista
    if isinstance(results, dict):
        for name, data in results.items():
            if isinstance(data, dict):
                items.append(
                    InterfaceItem(
                        name=name,
                        link_up=data.get("link", False) or data.get("status") == "up",
                        ip=data.get("ip"),
                        speed=data.get("speed"),
                        tx_bytes=data.get("tx_bytes"),
                        rx_bytes=data.get("rx_bytes"),
                        tx_packets=data.get("tx_packets"),
                        rx_packets=data.get("rx_packets"),
                        tx_errors=data.get("tx_errors"),
                        rx_errors=data.get("rx_errors"),
                    )
                )
    elif isinstance(results, list):
        for data in results:
            if isinstance(data, dict):
                items.append(
                    InterfaceItem(
                        name=data.get("name", "unknown"),
                        link_up=data.get("link", False) or data.get("status") == "up",
                        ip=data.get("ip"),
                        speed=data.get("speed"),
                        tx_bytes=data.get("tx_bytes"),
                        rx_bytes=data.get("rx_bytes"),
                        tx_packets=data.get("tx_packets"),
                        rx_packets=data.get("rx_packets"),
                        tx_errors=data.get("tx_errors"),
                        rx_errors=data.get("rx_errors"),
                    )
                )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(items)} interfaces de red.",
        data=items,
        vdom=raw.get("vdom") or vdom,
    )
