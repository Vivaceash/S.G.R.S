from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.devices import DeviceItem, DeviceListSummary

router = APIRouter(
    prefix="/devices",
    tags=["Dispositivos Conectados e Inventario"],
    dependencies=[Depends(verify_api_key)],
)


def _parse_device(item: Dict[str, Any]) -> DeviceItem:
    """Mapea un elemento crudo de FortiOS Device Query a nuestro modelo estructurado DeviceItem."""
    mac = item.get("mac", "")
    ip = item.get("ip") or item.get("ipv4_address")
    hostname = item.get("hostname") or item.get("name") or item.get("host")
    hw_vendor = item.get("hardware_vendor") or item.get("vendor")
    hw_family = item.get("hardware_family") or item.get("hardware_type")
    os_name = item.get("os_name") or item.get("os")
    os_version = item.get("os_version")
    interface = item.get("interface") or item.get("detected_interface") or item.get("master_interface")
    if not interface and isinstance(item.get("online_interfaces"), list) and len(item["online_interfaces"]) > 0:
        interface = item["online_interfaces"][0]

    is_online = item.get("is_online", True)
    last_seen = item.get("last_seen")
    device_type = item.get("device_type") or item.get("hardware_type") or item.get("type")

    return DeviceItem(
        mac=mac,
        ip=ip,
        hostname=hostname,
        hardware_vendor=hw_vendor,
        hardware_family=hw_family,
        os_name=os_name,
        os_version=os_version,
        interface=interface,
        is_online=is_online,
        last_seen=last_seen,
        device_type=device_type,
        raw_attributes=item,
    )


@router.get(
    "",
    response_model=BaseResponse[DeviceListSummary],
    summary="Listar todos los dispositivos conectados y detectados por el FortiGate",
)
async def list_connected_devices(
    online_only: bool = Query(False, description="Filtrar únicamente dispositivos actualmente activos/online"),
    vendor: Optional[str] = Query(None, max_length=100, description="Filtrar por fabricante (ej. Apple, Samsung, Intel, Cisco)"),
    search: Optional[str] = Query(None, max_length=100, description="Búsqueda por texto en IP, MAC o Hostname"),
    interface: Optional[str] = Query(None, max_length=50, description="Filtrar por interfaz (ej. port1, lan, wifi)"),
    vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar"),
):
    """
    Obtiene la lista completa de dispositivos conectados e inventariados por el motor Device Detection de FortiOS.
    Incluye dirección MAC, IP asignada, fabricante de hardware, sistema operativo, nombre de host e interfaz física.
    """
    raw = await fortios_client.get_connected_devices(vdom=vdom)
    results = raw.get("results", [])

    devices: List[DeviceItem] = []

    # results puede ser una lista de dispositivos o un diccionario
    raw_list = results if isinstance(results, list) else (results.get("devices", []) if isinstance(results, dict) else [])

    for dev_raw in raw_list:
        if isinstance(dev_raw, dict):
            dev = _parse_device(dev_raw)

            # Aplicar filtros
            if online_only and not dev.is_online:
                continue

            if vendor and (not dev.hardware_vendor or vendor.lower() not in dev.hardware_vendor.lower()):
                continue

            if interface and (not dev.interface or interface.lower() not in dev.interface.lower()):
                continue

            if search:
                search_lower = search.lower()
                matches_ip = dev.ip and search_lower in dev.ip.lower()
                matches_mac = dev.mac and search_lower in dev.mac.lower()
                matches_name = dev.hostname and search_lower in dev.hostname.lower()
                matches_vendor = dev.hardware_vendor and search_lower in dev.hardware_vendor.lower()
                if not (matches_ip or matches_mac or matches_name or matches_vendor):
                    continue

            devices.append(dev)

    online_count = sum(1 for d in devices if d.is_online)

    summary = DeviceListSummary(
        total_devices=len(devices),
        online_devices=online_count,
        devices=devices,
    )

    return BaseResponse(
        success=True,
        message=f"Se encontraron {len(devices)} dispositivos conectados.",
        data=summary,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/{mac_or_ip}",
    response_model=BaseResponse[DeviceItem],
    summary="Buscar información detallada de un dispositivo por su MAC o IP",
)
async def get_device_by_mac_or_ip(
    mac_or_ip: str = Path(..., max_length=50, pattern=r"^[a-zA-Z0-9:\-\.]{3,50}$", description="Dirección MAC o IP del dispositivo"),
    vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar"),
):
    """
    Busca un dispositivo en particular utilizando su dirección MAC o dirección IP.
    """
    raw = await fortios_client.get_connected_devices(vdom=vdom)
    results = raw.get("results", [])
    raw_list = results if isinstance(results, list) else (results.get("devices", []) if isinstance(results, dict) else [])

    search_term = mac_or_ip.strip().lower()

    for dev_raw in raw_list:
        if isinstance(dev_raw, dict):
            dev = _parse_device(dev_raw)
            dev_mac = (dev.mac or "").lower().replace("-", ":")
            clean_search = search_term.replace("-", ":")
            dev_ip = (dev.ip or "").lower()

            if clean_search in dev_mac or clean_search == dev_ip:
                return BaseResponse(
                    success=True,
                    message="Dispositivo encontrado.",
                    data=dev,
                    vdom=raw.get("vdom") or vdom,
                )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": "Device Not Found",
            "message": f"No se encontró ningún dispositivo con MAC o IP '{mac_or_ip}'.",
        },
    )
