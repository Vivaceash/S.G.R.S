import asyncio
import logging
from typing import Any, Dict, List, Optional, Union
import httpx

from app.core.config import settings
from app.core.errors import (
    FortiOSBaseException,
    FortiOSAuthError,
    FortiOSConnectionError,
    FortiOSNotFoundError,
    FortiOSResponseError,
)

logger = logging.getLogger("fortinet_api.client")


class FortiOSClient:
    """
    Cliente asíncrono para interactuar con la REST API de FortiOS (FortiGate).
    Utiliza connection pooling con HTTPX, inyección de Bearer token y manejo unificado de errores.
    """

    def __init__(self):
        self.base_url = settings.fortios_base_url
        self.token = settings.FORTIOS_API_TOKEN
        self.verify_ssl = settings.FORTIOS_VERIFY_SSL
        self.timeout = settings.FORTIOS_TIMEOUT
        self.default_vdom = settings.FORTIOS_DEFAULT_VDOM
        self._client: Optional[httpx.AsyncClient] = None
        self._loop = None

    async def get_client(self) -> httpx.AsyncClient:
        """Inicializa o retorna la instancia del cliente HTTPX con pooling."""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if self._client is None or self._client.is_closed or (current_loop and self._loop != current_loop):
            if self._client and not self._client.is_closed:
                try:
                    await self._client.aclose()
                except Exception:
                    pass

            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": f"FortiGate-FastAPI-Integration/{settings.APP_VERSION}",
            }
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                verify=self.verify_ssl,
                timeout=httpx.Timeout(self.timeout, connect=5.0),
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            )
            self._loop = current_loop

        return self._client

    async def close(self):
        """Cierra el pool de conexiones HTTPX al apagar la aplicación."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
            self._loop = None

    async def request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Union[Dict[str, Any], List[Any]]] = None,
        vdom: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Ejecuta una petición HTTP hacia FortiOS con validación de respuestas y control de excepciones.
        """
        client = await self.get_client()

        query_params = params.copy() if params else {}
        # Inyectar VDOM si no viene definido
        if "vdom" not in query_params:
            query_params["vdom"] = vdom or self.default_vdom

        clean_path = "/" + path.lstrip("/")

        try:
            response = await client.request(
                method=method.upper(),
                url=clean_path,
                params=query_params,
                json=json_data,
            )

            # Validar códigos de estado HTTP estándar
            if response.status_code == 401 or response.status_code == 403:
                raise FortiOSAuthError(
                    message=f"FortiOS rechazó la autenticación ({response.status_code}). Verifica el API Token y permisos.",
                    details={"status_code": response.status_code, "path": clean_path}
                )
            elif response.status_code == 404:
                raise FortiOSNotFoundError(
                    message=f"El recurso '{clean_path}' no fue encontrado en FortiOS.",
                    details={"status_code": response.status_code, "path": clean_path}
                )

            data = response.json()

            # FortiOS suele retornar un objeto con http_status o status
            http_status = data.get("http_status")
            if http_status and http_status >= 400:
                raise FortiOSResponseError(
                    message=f"FortiOS retornó error de estado {http_status}.",
                    status_code=http_status,
                    details=data
                )

            return data

        except httpx.ConnectError as exc:
            logger.error(f"Error de conexión con FortiGate en {self.base_url}: {exc}")
            raise FortiOSConnectionError(
                message=f"No se pudo conectar con el FortiGate en {self.base_url}. Verifica IP, puerto y conectividad de red.",
                details=str(exc)
            )
        except httpx.TimeoutException as exc:
            logger.error(f"Timeout al conectar con FortiGate ({self.timeout}s): {exc}")
            raise FortiOSConnectionError(
                message=f"Tiempo de espera agotado al conectar con FortiGate ({self.timeout}s).",
                details=str(exc)
            )
        except (FortiOSBaseException, FortiOSAuthError, FortiOSNotFoundError, FortiOSResponseError):
            raise
        except Exception as exc:
            logger.error(f"Error inesperado al consultar FortiOS: {exc}")
            raise FortiOSResponseError(
                message="Error inesperado durante la comunicación con FortiOS.",
                details=str(exc)
            )

    # -------------------------------------------------------------
    # Métodos de Monitoreo del Sistema & Salud
    # -------------------------------------------------------------
    async def get_system_status(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene estado general del FortiGate (hostname, serial, versión, uptime)."""
        return await self.request("GET", "api/v2/monitor/system/status", vdom=vdom)

    async def get_system_resources(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene consumo de CPU, Memoria RAM y almacenamiento en tiempo real."""
        return await self.request("GET", "api/v2/monitor/system/resource/usage", vdom=vdom)

    async def get_system_firmware(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene información sobre la versión y estado de firmware."""
        return await self.request("GET", "api/v2/monitor/system/firmware", vdom=vdom)

    # -------------------------------------------------------------
    # Métodos de Dispositivos Conectados e Inventario
    # -------------------------------------------------------------
    async def get_connected_devices(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """
        Consulta la base de datos de dispositivos detectados por FortiOS:
        MAC, IP, Hostname, Fabricante (Hardware Vendor), Sistema Operativo (OS), Interfaz.
        """
        return await self.request("GET", "api/v2/monitor/user/device/query", vdom=vdom)

    async def get_dhcp_leases(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene la lista de concesiones de IP activas asignadas por el servidor DHCP de FortiGate."""
        return await self.request("GET", "api/v2/monitor/system/dhcp", vdom=vdom)

    async def get_arp_table(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene la tabla de vecinos ARP (IP <-> MAC <-> Interfaz)."""
        try:
            return await self.request("GET", "api/v2/monitor/network/arp", vdom=vdom)
        except Exception:
            return await self.request("GET", "api/v2/monitor/system/arp", vdom=vdom)

    # -------------------------------------------------------------
    # Métodos de Red & Interfaces
    # -------------------------------------------------------------
    async def get_interfaces_status(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene el estado de las interfaces físicas/virtuales (link up/down, bytes tx/rx, velocidad)."""
        return await self.request("GET", "api/v2/monitor/system/interface", vdom=vdom)

    # -------------------------------------------------------------
    # Métodos de Tráfico, Sesiones y Sitios Visitados
    # -------------------------------------------------------------
    async def get_active_sessions(
        self,
        count: int = 100,
        filter_str: Optional[str] = None,
        vdom: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Obtiene la tabla de sesiones de tráfico activas (IP origen, IP destino, puertos, protocolo, bytes).
        """
        params: Dict[str, Any] = {"count": count}
        if filter_str:
            params["filter"] = filter_str
        return await self.request("GET", "api/v2/monitor/firewall/session", params=params, vdom=vdom)

    async def get_traffic_logs(
        self,
        log_type: str = "traffic",
        rows_per_page: int = 50,
        start: int = 0,
        filter_str: Optional[str] = None,
        vdom: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Consulta registros de tráfico y actividad de navegación.
        """
        params: Dict[str, Any] = {
            "rows_per_page": rows_per_page,
            "start": start,
        }
        if filter_str:
            params["filter"] = filter_str

        sources = ["disk", "memory", "fortianalyzer"]
        for source in sources:
            try:
                endpoint = f"api/v2/log/{source}/{log_type}"
                return await self.request("GET", endpoint, params=params, vdom=vdom)
            except Exception:
                continue

        return {"results": [], "count": 0}

    # -------------------------------------------------------------
    # Métodos de Políticas de Firewall & Objetos (CMDB)
    # -------------------------------------------------------------
    async def get_firewall_policies(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene la lista de políticas de firewall configuradas."""
        return await self.request("GET", "api/v2/cmdb/firewall/policy", vdom=vdom)

    async def get_firewall_addresses(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene la lista de objetos de dirección IP (Address Objects)."""
        return await self.request("GET", "api/v2/cmdb/firewall/address", vdom=vdom)

    async def get_firewall_address_groups(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene la lista de grupos de direcciones (Address Groups)."""
        return await self.request("GET", "api/v2/cmdb/firewall/addrgrp", vdom=vdom)

    # -------------------------------------------------------------
    # Métodos de VPN
    # -------------------------------------------------------------
    async def get_vpn_ipsec(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene estado de túneles VPN IPsec (Fase 1 y Fase 2, bytes, estado up/down)."""
        return await self.request("GET", "api/v2/monitor/vpn/ipsec", vdom=vdom)

    async def get_vpn_ssl_sessions(self, vdom: Optional[str] = None) -> Dict[str, Any]:
        """Obtiene lista de usuarios conectados activamente a la SSL-VPN."""
        return await self.request("GET", "api/v2/monitor/vpn/ssl", vdom=vdom)


# Instancia singleton del cliente FortiOS
fortios_client = FortiOSClient()
