import time
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


def _parse_device(
    item: Dict[str, Any],
    current_time: Optional[float] = None,
    active_window_seconds: int = 360,
) -> DeviceItem:
    """
    Mapea un elemento crudo de FortiOS Device Query a nuestro modelo estructurado DeviceItem.
    Calcula el estado online evaluando la marca de tiempo de última actividad (last_seen)
    frente a la ventana activa (device-idle-timeout de FortiOS) para reflejar con precisión
    los dispositivos realmente conectados en tiempo real frente al inventario histórico en caché.
    """
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

    last_seen = item.get("last_seen")
    now = current_time or time.time()

    # FortiOS conserva registros en caché durante 30 días con online_interfaces e is_online en True.
    # Un dispositivo está online si registró actividad dentro de la ventana de actividad reciente
    # evaluado de forma individual e independiente frente a la hora actual.
    if last_seen and isinstance(last_seen, (int, float)) and last_seen > 0:
        delta = now - last_seen
        is_online = (delta <= active_window_seconds) and (last_seen <= now + 300)
    else:
        is_online = False

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
    summary="Listar dispositivos detectados por el FortiGate (Inventario histórico, conectados y desconectados)",
)
async def list_connected_devices(
    status_filter: Optional[str] = Query(
        None,
        alias="status",
        pattern=r"^(?i)(all|online|offline)$",
        description="Filtrar por estado: 'all' (todo el inventario), 'online' (conectados) o 'offline' (desconectados)",
    ),
    online_only: Optional[bool] = Query(
        None,
        description="Filtrar únicamente dispositivos actualmente activos/online (retrocompatibilidad)",
    ),
    active_window: int = Query(
        360,
        ge=60,
        le=86400,
        description="Ventana de tiempo en segundos para validación de última actividad (por defecto 360s = 6 min)",
    ),
    vendor: Optional[str] = Query(None, max_length=100, description="Filtrar por fabricante (ej. Apple, Samsung, Intel, Cisco)"),
    search: Optional[str] = Query(None, max_length=100, description="Búsqueda por texto en IP, MAC o Hostname"),
    interface: Optional[str] = Query(None, max_length=50, description="Filtrar por interfaz (ej. port1, lan, wifi)"),
    vdom: Optional[str] = Query(None, pattern=r"^[a-zA-Z0-9_\-\.]{1,32}$", max_length=32, description="VDOM a consultar"),
):
    """
    Obtiene la lista de dispositivos inventariados por el motor Device Detection de FortiOS.
    Permite consultar tanto el inventario histórico completo como segmentar entre dispositivos
    actualmente conectados (online) y dispositivos fuera de línea / en caché (offline).
    """
    raw = await fortios_client.get_connected_devices(vdom=vdom)
    results = raw.get("results", [])

    # results puede ser una lista de dispositivos o un diccionario
    raw_list = results if isinstance(results, list) else (results.get("devices", []) if isinstance(results, dict) else [])

    now = time.time()

    # Parsear todos los dispositivos reportados por FortiOS
    all_devices: List[DeviceItem] = []
    for dev_raw in raw_list:
        if isinstance(dev_raw, dict):
            all_devices.append(_parse_device(dev_raw, current_time=now, active_window_seconds=active_window))

    total_inventory = len(all_devices)
    global_online_count = sum(1 for d in all_devices if d.is_online)
    global_offline_count = total_inventory - global_online_count

    # Determinar modo de filtrado por estado
    target_status = "all"
    if status_filter:
        target_status = status_filter.lower()
    elif online_only is True:
        target_status = "online"
    elif online_only is False:
        target_status = "all"

    filtered_devices: List[DeviceItem] = []
    for dev in all_devices:
        # 1. Filtro por estado
        if target_status == "online" and not dev.is_online:
            continue
        if target_status == "offline" and dev.is_online:
            continue

        # 2. Filtro por fabricante
        if vendor and (not dev.hardware_vendor or vendor.lower() not in dev.hardware_vendor.lower()):
            continue

        # 3. Filtro por interfaz
        if interface and (not dev.interface or interface.lower() not in dev.interface.lower()):
            continue

        # 4. Filtro de búsqueda libre (IP, MAC, Nombre, Fabricante)
        if search:
            search_lower = search.lower()
            matches_ip = dev.ip and search_lower in dev.ip.lower()
            matches_mac = dev.mac and search_lower in dev.mac.lower()
            matches_name = dev.hostname and search_lower in dev.hostname.lower()
            matches_vendor = dev.hardware_vendor and search_lower in dev.hardware_vendor.lower()
            if not (matches_ip or matches_mac or matches_name or matches_vendor):
                continue

        filtered_devices.append(dev)

    # Construir mensaje descriptivo
    if target_status == "online":
        message = (
            f"Se encontraron {len(filtered_devices)} dispositivos activos (en línea) "
            f"de un total de {total_inventory} en inventario."
        )
    elif target_status == "offline":
        message = (
            f"Se encontraron {len(filtered_devices)} dispositivos desconectados / históricos en caché "
            f"de un total de {total_inventory} en inventario."
        )
    else:
        message = (
            f"Inventario general: {len(filtered_devices)} dispositivos totales "
            f"({global_online_count} activos en línea, {global_offline_count} históricos en caché)."
        )

    summary = DeviceListSummary(
        total_inventory=total_inventory,
        online_devices=global_online_count,
        offline_devices=global_offline_count,
        returned_count=len(filtered_devices),
        total_devices=total_inventory,
        devices=filtered_devices,
    )

    return BaseResponse(
        success=True,
        message=message,
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
    now = time.time()
    for dev_raw in raw_list:
        if isinstance(dev_raw, dict):
            dev = _parse_device(dev_raw, current_time=now)
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
