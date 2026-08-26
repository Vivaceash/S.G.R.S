from collections import defaultdict
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query

from app.core.security import verify_api_key
from app.clients.fortios import fortios_client
from app.schemas.common import BaseResponse
from app.schemas.traffic import ActiveSessionItem, VisitedDestinationSummary, WebActivityRecord

router = APIRouter(
    prefix="/traffic",
    tags=["Tráfico, Sesiones y Sitios Visitados"],
    dependencies=[Depends(verify_api_key)],
)

PROTO_MAP = {
    1: "ICMP",
    6: "TCP",
    17: "UDP",
    47: "GRE",
    50: "ESP",
}


def _parse_session(raw: Dict[str, Any]) -> ActiveSessionItem:
    """Mapea una sesión de la tabla de sesiones de FortiOS."""
    proto_val = raw.get("proto") or raw.get("protocol")
    
    if isinstance(proto_val, int):
        proto_num = proto_val
        proto_name = PROTO_MAP.get(proto_num, str(proto_num))
    elif isinstance(proto_val, str):
        proto_name = proto_val.upper()
        # Invert lookup
        rev_map = {v: k for k, v in PROTO_MAP.items()}
        proto_num = rev_map.get(proto_name)
    else:
        proto_num = None
        proto_name = "UNKNOWN"

    src_ip = raw.get("saddr") or raw.get("src_ip") or raw.get("source_ip")
    src_port = raw.get("sport") or raw.get("src_port")
    dst_ip = raw.get("daddr") or raw.get("dst_ip") or raw.get("destination_ip")
    dst_port = raw.get("dport") or raw.get("dst_port")

    # Extraer nombre de aplicación
    app_name = raw.get("app_name") or raw.get("application") or raw.get("service")
    if not app_name and isinstance(raw.get("apps"), list) and len(raw["apps"]) > 0:
        first_app = raw["apps"][0]
        if isinstance(first_app, dict):
            app_name = first_app.get("name")

    bytes_sent = raw.get("sentbyte") or raw.get("sent_bytes") or raw.get("tx_bytes")
    bytes_rcvd = raw.get("rcvdbyte") or raw.get("rcvd_bytes") or raw.get("rx_bytes")

    return ActiveSessionItem(
        session_id=raw.get("session_id") or raw.get("id") or raw.get("sessionid"),
        src_ip=src_ip,
        src_port=int(src_port) if src_port is not None and str(src_port).isdigit() else None,
        dst_ip=dst_ip,
        dst_port=int(dst_port) if dst_port is not None and str(dst_port).isdigit() else None,
        protocol_name=proto_name,
        protocol_number=proto_num,
        policy_id=raw.get("policyid") or raw.get("policy_id"),
        application=app_name,
        bytes_sent=int(bytes_sent) if bytes_sent is not None and str(bytes_sent).isdigit() else None,
        bytes_received=int(bytes_rcvd) if bytes_rcvd is not None and str(bytes_rcvd).isdigit() else None,
        duration=raw.get("duration"),
        expiry=int(raw["expiry"]) if raw.get("expiry") and str(raw["expiry"]).isdigit() else None,
        raw_session=raw,
    )


def _get_raw_sessions_list(raw_res: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = raw_res.get("results", [])
    if isinstance(results, list):
        return results
    elif isinstance(results, dict):
        return results.get("details") or results.get("session_list") or results.get("sessions") or []
    return []


@router.get(
    "/sessions",
    response_model=BaseResponse[List[ActiveSessionItem]],
    summary="Consultar sesiones de tráfico en tiempo real",
)
async def get_active_traffic_sessions(
    src_ip: Optional[str] = Query(None, description="Filtrar por IP origen del cliente (ej. 192.168.1.100)"),
    dst_ip: Optional[str] = Query(None, description="Filtrar por IP destino / sitio web"),
    dst_port: Optional[int] = Query(None, description="Filtrar por puerto destino (ej. 80, 443, 53)"),
    limit: int = Query(100, ge=1, le=1000, description="Cantidad máxima de sesiones a retornar"),
    vdom: Optional[str] = Query(None, description="VDOM a consultar"),
):
    """
    Obtiene las sesiones de red activas en el firewall con detalle de IP origen, IP destino,
    puertos de conexión, protocolo de transporte y bytes transferidos.
    """
    raw = await fortios_client.get_active_sessions(count=limit, vdom=vdom)
    sessions_raw = _get_raw_sessions_list(raw)

    parsed_sessions: List[ActiveSessionItem] = []
    for s_raw in sessions_raw:
        if isinstance(s_raw, dict):
            s = _parse_session(s_raw)

            # Filtros
            if src_ip and s.src_ip and src_ip != s.src_ip:
                continue
            if dst_ip and s.dst_ip and dst_ip != s.dst_ip:
                continue
            if dst_port and s.dst_port and dst_port != s.dst_port:
                continue

            parsed_sessions.append(s)

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(parsed_sessions)} sesiones de tráfico activas.",
        data=parsed_sessions,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/destinations",
    response_model=BaseResponse[List[VisitedDestinationSummary]],
    summary="Top de destinos y sitios más visitados en tiempo real",
)
async def get_top_visited_destinations(
    min_sessions: int = Query(1, ge=1, description="Filtrar destinos con al menos este número de sesiones"),
    limit: int = Query(25, ge=1, le=100, description="Top N destinos a retornar"),
    vdom: Optional[str] = Query(None, description="VDOM a consultar"),
):
    """
    Agrupa y resume las conexiones activas para identificar qué servidores, IPs o destinos
    están recibiendo la mayor cantidad de tráfico y clientes conectados.
    """
    raw = await fortios_client.get_active_sessions(count=500, vdom=vdom)
    sessions_raw = _get_raw_sessions_list(raw)

    dest_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "session_count": 0,
        "total_bytes": 0,
        "ports_used": set(),
        "client_ips": set(),
    })

    for s_raw in sessions_raw:
        if isinstance(s_raw, dict):
            s = _parse_session(s_raw)
            dst = s.dst_ip
            if not dst:
                continue

            dest_stats[dst]["session_count"] += 1
            if s.bytes_sent:
                dest_stats[dst]["total_bytes"] += s.bytes_sent
            if s.bytes_received:
                dest_stats[dst]["total_bytes"] += s.bytes_received
            if s.dst_port:
                dest_stats[dst]["ports_used"].add(s.dst_port)
            if s.src_ip:
                dest_stats[dst]["client_ips"].add(s.src_ip)

    # Ordenar por cantidad de sesiones
    sorted_destinations = sorted(
        dest_stats.items(),
        key=lambda x: x[1]["session_count"],
        reverse=True
    )

    response_items: List[VisitedDestinationSummary] = []
    for dst, stats in sorted_destinations:
        if stats["session_count"] < min_sessions:
            continue
        response_items.append(
            VisitedDestinationSummary(
                destination=dst,
                session_count=stats["session_count"],
                total_bytes=stats["total_bytes"],
                ports_used=sorted(list(stats["ports_used"])),
                client_ips=sorted(list(stats["client_ips"])),
            )
        )
        if len(response_items) >= limit:
            break

    return BaseResponse(
        success=True,
        message=f"Se identificaron {len(response_items)} destinos principales.",
        data=response_items,
        vdom=raw.get("vdom") or vdom,
    )


@router.get(
    "/logs",
    response_model=BaseResponse[List[WebActivityRecord]],
    summary="Consultar logs de navegación, tráfico y sitios web visitados",
)
async def get_traffic_activity_logs(
    src_ip: Optional[str] = Query(None, description="Filtrar por IP cliente origen"),
    hostname: Optional[str] = Query(None, description="Filtrar por dominio o sitio web visitado"),
    limit: int = Query(50, ge=1, le=200, description="Cantidad máxima de registros de log"),
    vdom: Optional[str] = Query(None, description="VDOM a consultar"),
):
    """
    Consulta los registros de tráfico y filtro web guardados en el FortiGate.
    """
    filter_expr = None
    if src_ip:
        filter_expr = f"srcip=={src_ip}"

    try:
        raw = await fortios_client.get_traffic_logs(
            log_type="traffic",
            rows_per_page=limit,
            filter_str=filter_expr,
            vdom=vdom,
        )
    except Exception:
        raw = {"results": [], "count": 0}

    results = raw.get("results", [])
    logs_raw = results if isinstance(results, list) else results.get("data", [])

    records: List[WebActivityRecord] = []
    for log_item in logs_raw:
        if isinstance(log_item, dict):
            host = log_item.get("hostname") or log_item.get("dstname") or log_item.get("domain") or log_item.get("url")
            if hostname and host and hostname.lower() not in host.lower():
                continue

            rec = WebActivityRecord(
                timestamp=f"{log_item.get('date', '')} {log_item.get('time', '')}".strip() or str(log_item.get("itime", "")),
                src_ip=log_item.get("srcip"),
                src_name=log_item.get("srcname") or log_item.get("user"),
                dst_ip=log_item.get("dstip"),
                hostname=host,
                url=log_item.get("url"),
                service=log_item.get("service") or log_item.get("proto"),
                action=log_item.get("action") or log_item.get("status"),
                app_category=log_item.get("catdesc") or log_item.get("appcat"),
                sent_bytes=log_item.get("sentbyte"),
                rcvd_bytes=log_item.get("rcvdbyte"),
                raw_log=log_item,
            )
            records.append(rec)

    return BaseResponse(
        success=True,
        message=f"Se obtuvieron {len(records)} registros de actividad.",
        data=records,
        vdom=raw.get("vdom") or vdom,
    )
