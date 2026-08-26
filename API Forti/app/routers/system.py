from typing import Any, Dict, List, Optional, Union
from fastapi import APIRouter, Depends, Query

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.system import SystemStatusData, SystemResourceUsage

router = APIRouter(
    prefix="/system",
    tags=["Sistema y Recursos"],
    dependencies=[Depends(verify_api_key)],
)


def _format_uptime(seconds: Optional[int]) -> Optional[str]:
    if seconds is None:
        return None
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    parts.append(f"{secs}s")
    return " ".join(parts)


def _extract_metric_num(val: Any) -> Optional[float]:
    """Extrae de forma robusta un valor numérico de estructuras de FortiOS."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = val.strip().replace("%", "")
        try:
            return float(cleaned)
        except ValueError:
            return None
    if isinstance(val, list) and len(val) > 0:
        return _extract_metric_num(val[0])
    if isinstance(val, dict):
        for key in ("current", "value", "usage", "used", "total", "percentage", "percent"):
            if key in val:
                return _extract_metric_num(val[key])
    return None


@router.get(
    "/status",
    response_model=BaseResponse[SystemStatusData],
    summary="Obtener estado general del FortiGate (Hostname, Serial, Versión, Uptime)",
)
async def get_system_status(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    raw = await fortios_client.get_system_status(vdom=vdom)
    results: Dict[str, Any] = raw.get("results", {}) if isinstance(raw.get("results"), dict) else {}

    hostname = results.get("hostname") or raw.get("hostname")
    serial = results.get("serial") or raw.get("serial")
    version = results.get("version") or raw.get("version")
    build = results.get("build") or raw.get("build")
    
    model = results.get("model_name") or results.get("model") or raw.get("model")
    if results.get("model_number"):
        model = f"{model} {results.get('model_number')}".strip()

    uptime_sec = results.get("uptime") or raw.get("uptime")
    if isinstance(uptime_sec, str) and uptime_sec.isdigit():
        uptime_sec = int(uptime_sec)

    status_data = SystemStatusData(
        hostname=hostname,
        serial=serial,
        version=version,
        build=int(build) if build and str(build).isdigit() else None,
        firmware_version=f"{version} (build {build})" if version and build else (results.get("firmware_version") or version),
        uptime=uptime_sec if isinstance(uptime_sec, int) else None,
        uptime_human=_format_uptime(uptime_sec if isinstance(uptime_sec, int) else None),
        ha_mode=results.get("ha_mode") or raw.get("ha_mode"),
        vdom_enabled=results.get("vdom_enabled") or raw.get("vdom_enabled"),
        raw_details={**raw, **results},
    )

    return BaseResponse(
        success=True,
        message="Estado del sistema obtenido correctamente.",
        data=status_data,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/resources",
    response_model=BaseResponse[SystemResourceUsage],
    summary="Obtener consumo de CPU, Memoria RAM y Sesiones activas",
)
async def get_system_resources(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    raw = await fortios_client.get_system_resources(vdom=vdom)
    results: Dict[str, Any] = raw.get("results", {}) if isinstance(raw.get("results"), dict) else {}

    cpu_val = _extract_metric_num(results.get("cpu"))
    mem_val = _extract_metric_num(results.get("mem"))
    disk_val = _extract_metric_num(results.get("disk"))
    session_val = _extract_metric_num(results.get("session"))

    resource_data = SystemResourceUsage(
        cpu_percent=cpu_val,
        memory_percent=mem_val,
        disk_percent=disk_val,
        session_count=int(session_val) if session_val is not None else None,
        raw_details=results,
    )

    return BaseResponse(
        success=True,
        message="Métricas de recursos obtenidas correctamente.",
        data=resource_data,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/firmware",
    response_model=BaseResponse[Dict[str, Any]],
    summary="Obtener información detallada de Firmware y particiones",
)
async def get_system_firmware(vdom: Optional[str] = Query(None, description="VDOM a consultar")):
    raw = await fortios_client.get_system_firmware(vdom=vdom)
    return BaseResponse(
        success=True,
        message="Información de firmware obtenida correctamente.",
        data=raw.get("results", {}),
        vdom=raw.get("vdom") or vdom,
    )
