from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.firewall import (
    FirewallAddressGroupItem,
    FirewallAddressItem,
    FirewallPolicyItem,
)

router = APIRouter(
    prefix="/firewall",
    tags=["Políticas y Objetos de Firewall"],
    dependencies=[Depends(verify_api_key)],
)


def _extract_name_list(field_val: Any) -> List[str]:
    """Extrae nombres de estructuras [{'name': 'all'}] o strings simples de FortiOS."""
    if isinstance(field_val, list):
        names = []
        for item in field_val:
            if isinstance(item, dict) and "name" in item:
                names.append(item["name"])
            elif isinstance(item, str):
                names.append(item)
        return names
    elif isinstance(field_val, str):
        return [field_val]
    return []


@router.get(
    "/policies",
    response_model=BaseResponse[List[FirewallPolicyItem]],
    summary="Listar políticas de firewall configuradas",
)
async def list_firewall_policies(
    action: Optional[str] = Query(None, description="Filtrar por acción: accept o deny"),
    status: Optional[str] = Query(None, description="Filtrar por estado: enable o disable"),
    vdom: Optional[str] = Query(None, description="VDOM a consultar"),
):
    """
    Obtiene la lista de reglas y políticas de tráfico del firewall.
    """
    raw = await fortios_client.get_firewall_policies(vdom=vdom)
    results = raw.get("results", [])

    policies: List[FirewallPolicyItem] = []
    for item in results:
        if isinstance(item, dict):
            pol_action = item.get("action")
            pol_status = item.get("status")

            if action and pol_action and action.lower() != pol_action.lower():
                continue
            if status and pol_status and status.lower() != pol_status.lower():
                continue

            policies.append(
                FirewallPolicyItem(
                    policyid=item.get("policyid", 0),
                    name=item.get("name"),
                    srcintf=_extract_name_list(item.get("srcintf")),
                    dstintf=_extract_name_list(item.get("dstintf")),
                    srcaddr=_extract_name_list(item.get("srcaddr")),
                    dstaddr=_extract_name_list(item.get("dstaddr")),
                    action=pol_action,
                    status=pol_status,
                    service=_extract_name_list(item.get("service")),
                    nat=item.get("nat"),
                    schedule=item.get("schedule"),
                    logtraffic=item.get("logtraffic"),
                    comments=item.get("comments"),
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(policies)} políticas de firewall.",
        data=policies,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/addresses",
    response_model=BaseResponse[List[FirewallAddressItem]],
    summary="Listar objetos de dirección IP (Address Objects)",
)
async def list_firewall_addresses(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    """
    Obtiene la lista de objetos de dirección IP definidos en el FortiGate.
    """
    raw = await fortios_client.get_firewall_addresses(vdom=vdom)
    results = raw.get("results", [])

    addresses: List[FirewallAddressItem] = []
    for item in results:
        if isinstance(item, dict):
            addresses.append(
                FirewallAddressItem(
                    name=item.get("name", ""),
                    type=item.get("type"),
                    subnet=item.get("subnet"),
                    fqdn=item.get("fqdn"),
                    start_ip=item.get("start-ip"),
                    end_ip=item.get("end-ip"),
                    comment=item.get("comment"),
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(addresses)} objetos de dirección.",
        data=addresses,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/address-groups",
    response_model=BaseResponse[List[FirewallAddressGroupItem]],
    summary="Listar grupos de direcciones (Address Groups)",
)
async def list_firewall_address_groups(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    """
    Obtiene los grupos de direcciones agrupados en el FortiGate.
    """
    raw = await fortios_client.get_firewall_address_groups(vdom=vdom)
    results = raw.get("results", [])

    groups: List[FirewallAddressGroupItem] = []
    for item in results:
        if isinstance(item, dict):
            groups.append(
                FirewallAddressGroupItem(
                    name=item.get("name", ""),
                    members=_extract_name_list(item.get("member")),
                    comment=item.get("comment"),
                )
            )

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(groups)} grupos de direcciones.",
        data=groups,
        vdom=raw.get("vdom") or vdom,
    )
