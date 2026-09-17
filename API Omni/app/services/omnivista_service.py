import time
import logging
import requests
import urllib3
from typing import Dict, Any, List, Optional
from app.config import settings
from app.security.sanitizer import sanitize_data
from app.errors import (
    OmniVistaConnectionError,
    OmniVistaAuthError,
    OmniVistaResponseError,
)

logger = logging.getLogger("omnivista_api.client")

# Deshabilitar advertencias de certificados autofirmados solo si no se valida SSL
if not settings.OV_VERIFY_SSL and not settings.OV_CA_BUNDLE:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class OmniVistaService:
    """
    Servicio de integración para consultas con Alcatel-Lucent OmniVista 2500 NMS REST API.
    Soporta autenticación directa mediante API Key (External Applications) o
    fallback mediante sesión con usuario/contraseña (/api/login).
    """

    def __init__(self):
        self.base_url = settings.ov_base_url
        self.username = settings.OV_USERNAME
        self.password = settings.OV_PASSWORD
        self.api_key = settings.OV_API_KEY.strip() if settings.OV_API_KEY else ""
        
        # Validación TLS con CA bundle corporativo o flag booleano
        if settings.OV_CA_BUNDLE:
            self.verify_ssl = settings.OV_CA_BUNDLE
        else:
            self.verify_ssl = settings.OV_VERIFY_SSL

        self.session = requests.Session()
        self.session.verify = self.verify_ssl
        self.access_token: Optional[str] = None
        self.token_expiry: float = 0.0

        if self.api_key:
            self._apply_api_key(self.api_key)

    def _apply_api_key(self, api_key: str):
        """Aplica la API Key a las cabeceras HTTP de la sesión"""
        self.api_key = api_key.strip()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json"
        })

    def update_api_key(self, new_key: str):
        """Permite actualizar la API Key en caliente durante la ejecución"""
        self._apply_api_key(new_key)

    def login(self) -> bool:
        """Autentica contra OmniVista 2500 (/api/login) y almacena el token JWT de respaldo"""
        if not self.username or not self.password:
            return False

        url = f"{self.base_url}/api/login"
        payload = {
            "userName": self.username,
            "password": self.password
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        # Limpiar cabecera Authorization previa para evitar que un token caducado interfiera con /api/login
        self.session.headers.pop("Authorization", None)

        try:
            r = self.session.post(url, json=payload, headers=headers, timeout=12)
            if r.status_code == 200:
                data = r.json()
                self.access_token = data.get("accessToken")
                self.token_expiry = time.time() + (12 * 3600)
                self.session.headers.update({
                    "Authorization": f"Bearer {self.access_token}",
                    "Accept": "application/json"
                })
                return True
            return False
        except Exception:
            logger.warning("No fue posible completar el login con OmniVista.", exc_info=settings.DEBUG)
            return False

    def _ensure_authenticated(self):
        """Verifica y asegura que la sesión con OmniVista cuente con credenciales o token activo"""
        # Si ya contamos con API Key configurada en headers, procedemos directamente
        if self.api_key:
            if "Authorization" not in self.session.headers:
                self._apply_api_key(self.api_key)
            return

        # Si no hay API Key, verificar token de login
        if not self.access_token or time.time() > self.token_expiry:
            if not self.login():
                raise OmniVistaAuthError("No fue posible autenticar con el servidor Alcatel OmniVista 2500. Revisa la API Key o credenciales en .env.")

    def request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Envía una petición HTTP a OmniVista con reintentos y reautenticación automática"""
        self._ensure_authenticated()
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        url = f"{self.base_url}{endpoint}"

        try:
            response = self.session.request(method, url, **kwargs)
            # Si el servidor responde 401 y tenemos credenciales de username/password, intentar login de respaldo
            if response.status_code == 401 and self.username and self.password:
                if self.login():
                    response = self.session.request(method, url, **kwargs)
            return response
        except requests.exceptions.RequestException as exc:
            raise OmniVistaConnectionError(
                "No fue posible conectar con OmniVista 2500.",
                details=str(exc) if settings.DEBUG else None,
            )

    # =========================================================================
    # 1. Consultas de Cuentas de Empleados (UPAM)
    # =========================================================================

    def get_employee_accounts(
        self, page: int = 1, page_size: int = 50, search: Optional[str] = None
    ) -> Dict[str, Any]:
        """Obtiene la lista de cuentas de empleados con soporte de búsqueda y paginación"""
        if page * page_size > 10000:
            raise OmniVistaResponseError("La consulta supera el límite de lectura de 10,000 registros; requiere paginación compatible del proveedor.", status_code=422)
        payload = {
            "start": "",
            "querySize": min(10000, max(page * page_size + 1, page_size * 5 if search else 0)),
            "queryBy": "Account"
        }
        res = self.request("POST", "/api/ham/userAccount/getPageAllAccountList", json=payload, timeout=12)
        if res.status_code != 200:
            raise OmniVistaResponseError(
                "OmniVista rechazó la consulta de cuentas de empleados.",
                status_code=502,
                details={"upstream_status": res.status_code},
            )

        data = self._required_json(res)
        raw_items = data.get("data", [])

        if search:
            search_lower = search.lower()
            raw_items = [
                item for item in raw_items
                if search_lower in (item.get("username") or "").lower()
                or search_lower in (item.get("fullName") or "").lower()
                or search_lower in (item.get("email") or "").lower()
                or search_lower in (item.get("department") or "").lower()
                or search_lower in (item.get("position") or "").lower()
                or search_lower in (item.get("telephone") or "").lower()
                or search_lower in (item.get("accessRoleProfile") or "").lower()
            ]

        total = len(raw_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = raw_items[start_idx:end_idx]

        # Sanitizar contraseñas y secretos antes de devolver al cliente
        cleaned_items = []
        sensitive_keys = {"password", "repeat", "userPassword", "secret", "psk", "devicePSK"}
        for item in paginated_items:
            item_copy = {k: v for k, v in item.items() if k not in sensitive_keys}
            cleaned_items.append(sanitize_data(item_copy))

        return {
            "items": cleaned_items,
            "total": None,
            "returned_count": len(cleaned_items),
            "complete": False,
            "page": page,
            "page_size": page_size,
            "has_more": True if end_idx < total else None
        }

    def get_employee_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Busca una cuenta de empleado específica por su username"""
        accounts = self.get_employee_accounts(page=1, page_size=1000, search=username)
        for acc in accounts["items"]:
            if acc.get("username", "").lower() == username.lower():
                return acc
        return None

    # =========================================================================
    # 2. Consultas de Dispositivos y MACs (Company Property)
    # =========================================================================

    def get_company_properties(
        self, page: int = 1, page_size: int = 50, search: Optional[str] = None
    ) -> Dict[str, Any]:
        """Obtiene la lista de dispositivos / MACs registradas en Company Property"""
        if page * page_size > 10000:
            raise OmniVistaResponseError("La consulta supera el límite de lectura de 10,000 registros; requiere paginación compatible del proveedor.", status_code=422)
        payload = {
            "start": "",
            "querySize": min(10000, max(page * page_size + 1, page_size * 5 if search else 0)),
            "queryBy": "Account"
        }
        res = self.request("POST", "/api/ham/enterpriseProperty/getAllPageEnterprisePropertyInfo", json=payload, timeout=12)
        if res.status_code != 200:
            raise OmniVistaResponseError(
                "OmniVista rechazó la consulta de dispositivos corporativos.",
                status_code=502,
                details={"upstream_status": res.status_code},
            )

        data = self._required_json(res)
        raw_items = data.get("data", [])

        if search:
            s = search.lower()
            raw_items = [
                item for item in raw_items
                if s in (item.get("deviceMac") or "").lower()
                or s in (item.get("deviceName") or "").lower()
                or s in (item.get("account") or "").lower()
                or s in (item.get("accessRoleProfile") or "").lower()
                or s in (item.get("deviceCategory") or "").lower()
                or s in (item.get("deviceFamily") or "").lower()
                or s in (item.get("deviceOS") or "").lower()
            ]

        total = len(raw_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = raw_items[start_idx:end_idx]

        return {
            "items": sanitize_data(paginated_items),
            "total": None,
            "returned_count": len(paginated_items),
            "complete": False,
            "page": page,
            "page_size": page_size,
            "has_more": True if end_idx < total else None
        }

    def get_company_property_by_mac(self, device_mac: str) -> Optional[Dict[str, Any]]:
        """Busca un registro de Company Property por su dirección MAC normalizada"""
        clean_mac = device_mac.replace(":", "").replace("-", "").replace(".", "").upper()
        res = self.get_company_properties(page=1, page_size=1000, search=clean_mac)
        for item in res["items"]:
            if (item.get("deviceMac") or "").upper() == clean_mac:
                return item
        return None

    # =========================================================================
    # 3. Catálogos y Perfiles de Red
    # =========================================================================

    def get_access_role_profiles(self) -> List[str]:
        """Obtiene la lista de nombres de perfiles de red / SSIDs configurados en OmniVista"""
        res = self.request("GET", "/api/ag/uatemplate/AccessRoleProfile", timeout=8)
        if res.status_code == 200:
            data = res.json()
            items = data.get("response", [])
            profiles = [p.get("name") for p in items if p.get("name")]
            return sorted(profiles)
        return []

    def get_device_options(self) -> Dict[str, List[Dict[str, str]]]:
        """Devuelve las opciones estándar de categorías, familias y sistemas operativos"""
        return {
            "categories": [
                {"label": "Mobile (Celular / Tablet)", "value": "Mobile"},
                {"label": "Computer (Laptop / PC)", "value": "Computer"},
                {"label": "Printer (Impresora)", "value": "Printer"},
                {"label": "SmartTV / Multimedia", "value": "SmartTV"},
                {"label": "IoT / Dispositivo Inteligente", "value": "IoT"},
                {"label": "Otros", "value": "Others"}
            ],
            "families": [
                {"label": "Android", "value": "Android"},
                {"label": "Apple iOS (iPhone / iPad)", "value": "Apple iOS"},
                {"label": "Apple macOS", "value": "macOS"},
                {"label": "Microsoft Windows", "value": "Windows"},
                {"label": "Linux", "value": "Linux"},
                {"label": "Otros", "value": "Others"}
            ],
            "operating_systems": [
                {"label": "Android", "value": "Android"},
                {"label": "iOS", "value": "iOS"},
                {"label": "Windows 11", "value": "Windows 11"},
                {"label": "Windows 10", "value": "Windows 10"},
                {"label": "macOS", "value": "macOS"},
                {"label": "Linux", "value": "Linux"},
                {"label": "Otros", "value": "Others"}
            ]
        }

    def get_vlans(self) -> List[Dict[str, Any]]:
        """Obtiene la lista de VLANs configuradas en la infraestructura"""
        res = self.request("GET", "/api/vlan", timeout=10)
        data = self._required_json(res)
        if isinstance(data, dict):
            data = data.get("response", data.get("data"))
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise OmniVistaResponseError("El proveedor no entregó un catálogo de VLANs válido.")
        return sanitize_data(data)

    @staticmethod
    def _required_json(response):
        """Never represent an unavailable endpoint or HTML login page as empty data."""
        if not 200 <= response.status_code < 300:
            raise OmniVistaResponseError("La consulta no está disponible en el proveedor.")
        try:
            data = response.json()
        except ValueError:
            raise OmniVistaResponseError("El proveedor no entregó una respuesta JSON válida.") from None
        if not isinstance(data, (dict, list)):
            raise OmniVistaResponseError("El proveedor entregó un formato no compatible.")
        if isinstance(data, dict) and (data.get("success") is False or data.get("error")):
            raise OmniVistaResponseError("El proveedor rechazó la consulta.")
        return data

    # =========================================================================
    # 4. Infraestructura, Monitoreo y Topología
    # =========================================================================

    def get_devices(self) -> List[Dict[str, Any]]:
        """Lista completa de switches y APs en la red"""
        res = self.request("GET", "/api/devices", timeout=12)
        if res.status_code != 200:
            raise OmniVistaResponseError('No se pudo consultar el inventario administrado.')
        try:
            data = res.json()
        except ValueError:
            raise OmniVistaResponseError('El inventario administrado no contiene JSON válido.') from None
        rows = data if isinstance(data, list) else data.get('response') if isinstance(data, dict) else None
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise OmniVistaResponseError('El inventario administrado tiene un formato no reconocido.')
        return sanitize_data(rows)

    def get_device_by_ip(self, ip_address: str) -> Optional[Dict[str, Any]]:
        """Busca un equipo de infraestructura por su dirección IP"""
        devices = self.get_devices()
        for d in devices:
            dev_ip = d.get("ipAddress") or d.get("ip") or d.get("deviceIp")
            if dev_ip == ip_address:
                return d
        return None

    def get_online_devices(self) -> List[Dict[str, Any]]:
        """Lista de dispositivos autenticados y online en la red (RADIUS / 802.1X)"""
        payload = {"start": "", "querySize": 200, "queryBy": "Account"}
        res = self.request("POST", "/api/ham/radius/onlineDevice/getPageEnterprisePropertyOnlineDeviceList", json=payload, timeout=8)
        if res.status_code == 200:
            data = res.json()
            return sanitize_data(data.get("data", []))
        return []

    def get_infrastructure_stats(self) -> Dict[str, Any]:
        """Calcula el resumen métrico de infraestructura y registros"""
        devices = self.get_devices()
        aps_count = sum(1 for d in devices if "AP" in (d.get("model") or d.get("chassisType") or d.get("sysName") or ""))
        switches_count = sum(1 for d in devices if "AP" not in (d.get("model") or d.get("chassisType") or d.get("sysName") or "") and ("AOS" in (d.get("model") or d.get("chassisType") or "") or "IDF" in (d.get("sysName") or "")))
        other_devices = len(devices) - (aps_count + switches_count)

        # Provider returns pages without a verified total. Never use page length.
        emp_count = None
        mac_count = None

        return {
            "totalDevices": len(devices),
            "accessPointsCount": aps_count,
            "switchesCount": switches_count,
            "otherDevicesCount": max(0, other_devices),
            "registeredEmployeesCount": emp_count,
            "registeredMacsCount": mac_count
        }

    def get_topology(self) -> Any:
        """Obtiene la topología de interconexión de dispositivos de red"""
        res = self.request("GET", "/api/topology/devices", timeout=12)
        return sanitize_data(self._required_json(res))

    def get_notifications(self) -> Any:
        """Obtiene las alarmas, advertencias y notificaciones activas del NMS"""
        res = self.request("GET", "/api/notifications", timeout=10)
        return sanitize_data(self._required_json(res))

    # =========================================================================
    # 5. Diagnóstico y Sistema
    # =========================================================================

    def get_system_version(self) -> Any:
        """Obtiene la información de versión y estado del sistema OmniVista"""
        res = self.request("GET", "/api/system/version", timeout=8)
        return sanitize_data(self._required_json(res))

    def health_check(self) -> Dict[str, Any]:
        """Prueba de conectividad y latencia con OmniVista 2500"""
        start = time.time()
        connected = False
        message = ""
        try:
            if self.api_key:
                # Probar endpoint de dispositivos con la API Key configurada
                res = self.request("GET", "/api/devices", timeout=8)
                if res.status_code == 200 and "json" in res.headers.get("Content-Type", ""):
                    connected = True
                    message = "Conexión exitosa con OmniVista 2500 (Autenticado vía API Key)"
                else:
                    # Si falla, verificar con login tradicional como respaldo
                    if self.username and self.password and self.login():
                        connected = True
                        message = "Conexión exitosa con OmniVista 2500 (Fallback vía credenciales)"
                    else:
                        message = f"OmniVista respondió con HTTP {res.status_code}"
            else:
                connected = self.login()
                message = "Conexión exitosa con OmniVista 2500" if connected else "Credenciales o login fallido"
        except Exception as exc:
            message = f"Error de enlace: {str(exc)}" if settings.DEBUG else "Error de enlace con OmniVista"

        elapsed_ms = round((time.time() - start) * 1000, 2)

        return {
            "status": "healthy" if connected else "unhealthy",
            "omnivista_host": self.base_url,
            "omnivista_connected": connected,
            "latency_ms": elapsed_ms,
            "auth_mode": "API_KEY" if self.api_key else "CREDENTIALS",
            "message": message
        }


# Instancia singleton del servicio
omnivista_service = OmniVistaService()
