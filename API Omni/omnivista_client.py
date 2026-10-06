"""
Cliente Python para Alcatel-Lucent OmniVista 2500 NMS REST API
Compatible con OmniVista 2500 v4.x (4.8R2 GA y superiores)
"""

import os
import requests
import urllib3
from typing import Optional, Dict, Any, List

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class OmniVistaClient:
    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        protocol: str = "https",
        username: Optional[str] = None,
        password: Optional[str] = None,
        api_key: Optional[str] = None,
        verify_ssl: bool = True,
        env_file: str = ".env"
    ):
        # Cargar variables desde .env si están disponibles
        env_config = self._load_env(env_file)
        
        self.host = host or env_config.get("OV_HOST", "192.168.10.201")
        self.port = int(port or env_config.get("OV_PORT", "443"))
        self.protocol = protocol or env_config.get("OV_PROTOCOL", "https")
        self.username = username or env_config.get("OV_USERNAME", "")
        self.password = password or env_config.get("OV_PASSWORD", "")
        self.api_key = api_key or env_config.get("OV_API_KEY", "")
        self.verify_ssl = verify_ssl if verify_ssl is not None else (env_config.get("OV_VERIFY_SSL", "true").lower() == "true")
        
        self.base_url = f"{self.protocol}://{self.host}" if self.port in (80, 443) else f"{self.protocol}://{self.host}:{self.port}"
        
        self.session = requests.Session()
        self.session.verify = self.verify_ssl
        self.access_token: Optional[str] = None

    def _load_env(self, env_path: str) -> Dict[str, str]:
        config = {}
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        config[k.strip()] = v.strip().strip('"').strip("'")
        return config

    def login(self) -> bool:
        """Autentica contra /api/login y almacena el token de sesión"""
        url = f"{self.base_url}/api/login"
        payload = {
            "userName": self.username,
            "password": self.password
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        try:
            response = self.session.post(url, json=payload, headers=headers, timeout=12)
            if response.status_code == 200:
                data = response.json()
                self.access_token = data.get("accessToken")
                self.session.headers.update({
                    "Authorization": f"Bearer {self.access_token}",
                    "Accept": "application/json"
                })
                return True
            else:
                print(f"[OmniVistaClient] Error de login HTTP {response.status_code}")
                return False
        except Exception as e:
            print(f"[OmniVistaClient] Excepción durante login: {type(e).__name__}")
            return False

    def request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Realiza una petición HTTP manejando reautenticación automática"""
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        url = f"{self.base_url}{endpoint}"
        
        if not self.access_token and self.username and self.password:
            self.login()

        response = self.session.request(method, url, **kwargs)
        
        # Reintentar una vez si el token expiró (HTTP 401)
        if response.status_code == 401 and self.username and self.password:
            if self.login():
                response = self.session.request(method, url, **kwargs)
                
        return response

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        return self.request("GET", endpoint, params=params)

    def post(self, endpoint: str, json_data: Optional[Dict[str, Any]] = None) -> requests.Response:
        return self.request("POST", endpoint, json=json_data)

    # =========================================================================
    # Métodos de alto nivel para gestión de red
    # =========================================================================

    def get_devices(self) -> List[Dict[str, Any]]:
        """Obtiene la lista completa de dispositivos de red administrados (switches, APs, routers)"""
        r = self.get("/api/devices")
        if r.status_code == 200:
            try:
                data = r.json()
                if isinstance(data, dict):
                    return data.get("response", [])
                elif isinstance(data, list):
                    return data
            except Exception:
                pass
        return []

    def get_devices_summary(self) -> List[Dict[str, Any]]:
        """Obtiene una lista simplificada y estandarizada de todos los dispositivos"""
        raw_devices = self.get_devices()
        summary = []
        for d in raw_devices:
            summary.append({
                "ip": d.get("ipAddress") or d.get("ip") or d.get("deviceIp"),
                "name": d.get("sysName") or d.get("name") or d.get("deviceName"),
                "model": d.get("chassisType") or d.get("model") or d.get("deviceType"),
                "mac": d.get("macAddress") or d.get("mac"),
                "status": d.get("status") or d.get("operStatus"),
                "location": d.get("location"),
                "serialNumber": d.get("serialNumber")
            })
        return summary

    def get_device_by_ip(self, ip_address: str) -> Optional[Dict[str, Any]]:
        """Busca un dispositivo específico por su dirección IP"""
        devices = self.get_devices()
        for d in devices:
            dev_ip = d.get("ipAddress") or d.get("ip") or d.get("deviceIp")
            if dev_ip == ip_address:
                return d
        return None

    def get_topology(self) -> Any:
        """Obtiene los datos de topología de la red"""
        r = self.get("/api/topology/devices")
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return r.text
        return None

    def get_notifications(self) -> Any:
        """Obtiene notificaciones y alarmas activas"""
        r = self.get("/api/notifications")
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return r.text
        return None

    def get_users(self) -> Any:
        """Obtiene la lista de usuarios de OmniVista"""
        r = self.get("/api/users")
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return r.text
        return None

    def get_system_version(self) -> Any:
        """Obtiene información y versión del sistema OmniVista"""
        r = self.get("/api/system/version")
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return r.text
        return None
