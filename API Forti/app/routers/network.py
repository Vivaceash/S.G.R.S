import ipaddress
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.network import (
    ARPEntry,
    DHCPLeaseItem,
    DhcpPoolScope,
    DhcpPoolSummary,
    InterfaceItem,
)

router = APIRouter(
    prefix="/network",
    tags=["Red, DHCP e Interfaces"],
    dependencies=[Depends(verify_api_key)],
)


def _calculate_ip_range_count(start_ip: str, end_ip: str) -> int:
    """Calcula la cantidad de direcciones IPv4 utilizables en un rango inclusivo."""
    try:
        start = int(ipaddress.IPv4Address(start_ip.strip()))
        end = int(ipaddress.IPv4Address(end_ip.strip()))
        return max(0, end - start + 1)
    except Exception:
        return 0


@router.get(
    "/dhcp-pools",
    response_model=BaseResponse[DhcpPoolSummary],
    summary="Consultar capacidad, asignaciones y saturación de los pools DHCP",
)
async def get_dhcp_pools(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
    """
    Analiza la capacidad máxima configurada en los servidores/scopes DHCP del FortiGate,
    las concesiones activas entregadas en cada interfaz/VLAN y calcula el porcentaje de saturación
    y las direcciones IP libres disponibles en tiempo real.
    """
    # 1. Obtener configuración de DHCP Servers en CMDB
    servers_raw = await fortios_client.request("GET", "api/v2/cmdb/system.dhcp/server", params={"vdom": vdom or "root"})
    servers = servers_raw.get("results", [])
    if isinstance(servers, dict):
        servers = servers.get("servers", [])
    elif not isinstance(servers, list):
        servers = []

    # 2. Obtener concesiones activas
    leases_raw = await fortios_client.get_dhcp_leases(vdom=vdom)
    leases = leases_raw.get("results", [])
    if isinstance(leases, dict):
        leases = leases.get("leases", [])
    elif not isinstance(leases, list):
        leases = []

    leases_by_intf: Dict[str, int] = {}
    for l in leases:
        if isinstance(l, dict):
            intf_name = l.get("interface") or l.get("intf")
            if intf_name:
                leases_by_intf[intf_name] = leases_by_intf.get(intf_name, 0) + 1

    pool_items: List[DhcpPoolScope] = []
    total_capacity = 0
    total_active_leases = len(leases)
    critical_count = 0
    warning_count = 0

    for s in servers:
        if not isinstance(s, dict):
            continue
        status_val = s.get("status", "enable")
        if status_val != "enable":
            continue

        s_id = s.get("id", 0)
        intf = s.get("interface") or "N/A"
        gw = s.get("default-gateway") or s.get("default_gateway")
        netmask = s.get("netmask")
        lease_time = s.get("lease-time") or s.get("lease_time")

        ip_ranges_raw = s.get("ip-range") or s.get("ip_range") or []
        scope_capacity = 0
        range_strs: List[str] = []

        if isinstance(ip_ranges_raw, list):
            for r in ip_ranges_raw:
                if isinstance(r, dict):
                    start = r.get("start-ip") or r.get("start_ip", "")
                    end = r.get("end-ip") or r.get("end_ip", "")
                    if start and end:
                        c = _calculate_ip_range_count(start, end)
                        scope_capacity += c
                        range_strs.append(f"{start} - {end}")

        active_in_scope = leases_by_intf.get(intf, 0)
        utilization_pct = round((active_in_scope / scope_capacity * 100), 1) if scope_capacity > 0 else 0.0
        available_ips = max(0, scope_capacity - active_in_scope)
        total_capacity += scope_capacity

        if utilization_pct >= 80.0:
            scope_status = "critical"
            critical_count += 1
        elif utilization_pct >= 50.0:
            scope_status = "warning"
            warning_count += 1
        else:
            scope_status = "normal"

        pool_items.append(
            DhcpPoolScope(
                id=s_id,
                interface=intf,
                default_gateway=gw,
                netmask=netmask,
                ip_ranges=range_strs,
                capacity=scope_capacity,
                active_leases=active_in_scope,
                available_ips=available_ips,
                utilization_percent=utilization_pct,
                status=scope_status,
                saturation_status=scope_status,
                lease_time_seconds=lease_time if isinstance(lease_time, int) else None,
            )
        )

    # Ordenar pools: primero los que tienen concesiones activas o mayor porcentaje de saturación
    pool_items.sort(key=lambda p: (p.active_leases > 0, p.utilization_percent, p.active_leases), reverse=True)

    global_pct = round((total_active_leases / total_capacity * 100), 1) if total_capacity > 0 else 0.0
    total_available = max(0, total_capacity - total_active_leases)

    summary = DhcpPoolSummary(
        total_pools=len(pool_items),
        total_capacity=total_capacity,
        total_active_leases=total_active_leases,
        total_available_ips=total_available,
        global_saturation_percent=global_pct,
        critical_pools_count=critical_count,
        warning_pools_count=warning_count,
        pools=pool_items,
    )

    message = (
        f"Análisis DHCP: {total_active_leases} concesiones activas de {total_capacity} IPs en {len(pool_items)} pools "
        f"({global_pct}% de saturación global). {critical_count} pools en estado crítico, {warning_count} en advertencia."
    )

    return BaseResponse(
        success=True,
        message=message,
        data=summary,
        vdom=servers_raw.get("vdom") or vdom,
    )


@router.get(
    "/dhcp-leases",
    response_model=BaseResponse[List[DHCPLeaseItem]],
    summary="Listar concesiones DHCP activas",
)
async def get_dhcp_leases(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
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
async def get_arp_table(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
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
async def get_interfaces_status(vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar")):
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
