import time
import requests
import urllib3
from typing import Dict, Any, List, Optional, Tuple
from app.config import settings
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeResponse
from app.schemas.company_property import CompanyPropertyCreate, CompanyPropertyUpdate, CompanyPropertyResponse
from app.schemas.enrollment import CompleteEnrollmentRequest, CompleteEnrollmentResponse

# Deshabilitar advertencias de certificados autofirmados
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class OmniVistaService:
    def __init__(self):
        self.base_url = settings.ov_base_url
        self.username = settings.OV_USERNAME
        self.password = settings.OV_PASSWORD
        self.verify_ssl = settings.OV_VERIFY_SSL
        self.session = requests.Session()
        self.session.verify = self.verify_ssl
        self.access_token: Optional[str] = None
        self.token_expiry: float = 0.0

    def login(self) -> bool:
        """Autentica contra OmniVista 2500 (/api/login) y almacena el token JWT"""
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
            r = self.session.post(url, json=payload, headers=headers, timeout=12)
            if r.status_code == 200:
                data = r.json()
                self.access_token = data.get("accessToken")
                # Token típicamente válido por meses; renovamos si pasan 12 horas
                self.token_expiry = time.time() + (12 * 3600)
                self.session.headers.update({
                    "Authorization": f"Bearer {self.access_token}",
                    "Accept": "application/json"
                })
                return True
            return False
        except Exception as e:
            print(f"[OmniVistaService] Excepción durante login: {e}")
            return False

    def _ensure_authenticated(self):
        """Verifica y asegura que la sesión con OmniVista esté activa"""
        if not self.access_token or time.time() > self.token_expiry:
            if not self.login():
                raise ConnectionError("No fue posible autenticar con el servidor Alcatel OmniVista 2500.")

    def request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Envía una petición HTTP a OmniVista con reintentos y reautenticación automática"""
        self._ensure_authenticated()
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        url = f"{self.base_url}{endpoint}"

        try:
            response = self.session.request(method, url, **kwargs)
            # Si el token expiró en el servidor (HTTP 401), reautenticar una vez
            if response.status_code == 401:
                if self.login():
                    response = self.session.request(method, url, **kwargs)
            return response
        except requests.exceptions.RequestException as e:
            raise ConnectionError(f"Error de conexión con OmniVista 2500 en '{endpoint}': {str(e)}")

    # =========================================================================
    # 1. Employee Accounts (Gestión de Cuentas de Empleados)
    # =========================================================================

    def get_employee_accounts(
        self, page: int = 1, page_size: int = 50, search: Optional[str] = None
    ) -> Dict[str, Any]:
        """Obtiene la lista de cuentas de empleados con soporte de búsqueda y paginación"""
        payload = {
            "start": "",
            "querySize": page_size * 5 if search else page_size,
            "queryBy": "Account"
        }
        res = self.request("POST", "/api/ham/userAccount/getPageAllAccountList", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error consultando cuentas de empleados: {res.text}")

        data = res.json()
        raw_items = data.get("data", [])

        # Filtrar por búsqueda si se especificó
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

        # Sanitizar contraseñas antes de devolver al cliente
        cleaned_items = []
        for item in paginated_items:
            item_copy = dict(item)
            item_copy.pop("password", None)
            item_copy.pop("repeat", None)
            cleaned_items.append(item_copy)

        return {
            "items": cleaned_items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": end_idx < total
        }

    def get_employee_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Busca una cuenta de empleado específica por su username"""
        accounts = self.get_employee_accounts(page=1, page_size=1000, search=username)
        for acc in accounts["items"]:
            if acc.get("username", "").lower() == username.lower():
                return acc
        return None

    def create_employee_account(self, data: EmployeeCreate) -> Dict[str, Any]:
        """Da de alta una nueva cuenta de empleado en OmniVista UPAM"""
        payload = {
            "username": data.username,
            "password": data.password,
            "repeat": data.repeatPassword,
            "fullName": data.fullName or "",
            "telephone": data.telephone or "",
            "email": data.email or "",
            "department": data.department or "",
            "position": data.position or "",
            "description": data.description or "",
            "accessRoleProfile": data.accessRoleProfile or "",
            "policyList": data.policyList or "",
            "status": data.status if data.status is not None else 1,
            "otherAttributesVOs": []
        }

        res = self.request("POST", "/api/ham/userAccount/addUser", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error registrando cuenta de empleado: {res.text}")

        res_data = res.json()
        if res_data.get("errorCode", 0) != 0 and res_data.get("result", "").lower() == "fail":
            err_msg = res_data.get("errorMessage", "Error desconocido al registrar cuenta.")
            raise ValueError(f"OmniVista rechazó el registro: {err_msg}")

        return {
            "success": True,
            "username": data.username,
            "fullName": data.fullName,
            "accessRoleProfile": data.accessRoleProfile,
            "status": data.status
        }

    def update_employee_account(self, username: str, data: EmployeeUpdate) -> Dict[str, Any]:
        """Modifica los datos de una cuenta de empleado existente"""
        existing = self.get_employee_by_username(username)
        if not existing:
            raise ValueError(f"No se encontró la cuenta de empleado '{username}'.")

        payload = dict(existing)
        payload["username"] = username

        if data.password:
            payload["password"] = data.password
            payload["repeat"] = data.repeatPassword or data.password
        if data.fullName is not None:
            payload["fullName"] = data.fullName
        if data.telephone is not None:
            payload["telephone"] = data.telephone
        if data.email is not None:
            payload["email"] = data.email
        if data.department is not None:
            payload["department"] = data.department
        if data.position is not None:
            payload["position"] = data.position
        if data.description is not None:
            payload["description"] = data.description
        if data.accessRoleProfile is not None:
            payload["accessRoleProfile"] = data.accessRoleProfile
        if data.policyList is not None:
            payload["policyList"] = data.policyList
        if data.status is not None:
            payload["status"] = data.status

        res = self.request("POST", "/api/ham/userAccount/editAccount", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error modificando cuenta de empleado: {res.text}")

        return {"success": True, "username": username}

    def delete_employee_account(self, username: str) -> Dict[str, Any]:
        """Da de baja / elimina una cuenta de empleado en OmniVista UPAM"""
        existing = self.get_employee_by_username(username)
        if not existing:
            raise ValueError(f"No se encontró la cuenta de empleado '{username}'.")
        emp_id = existing.get("id")
        if not emp_id:
            raise ValueError(f"No se pudo obtener el ID numérico de la cuenta '{username}'.")

        # OmniVista espera una lista de IDs enteros: [1301]
        payload = [int(emp_id)]
        res = self.request("POST", "/api/ham/userAccount/deleteAccount", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error eliminando cuenta de empleado: {res.text}")

        return {"success": True, "username": username, "id": emp_id}

    def switch_employee_status(self, username: str, status: int) -> Dict[str, Any]:
        """Activa (1) o desactiva (0) una cuenta de empleado"""
        existing = self.get_employee_by_username(username)
        if not existing:
            raise ValueError(f"No se encontró la cuenta de empleado '{username}'.")
        emp_id = existing.get("id")
        if not emp_id:
            raise ValueError(f"No se pudo obtener el ID numérico de la cuenta '{username}'.")

        # OmniVista espera {"id": [emp_id], "status": status}
        payload = {"id": [int(emp_id)], "status": status}
        res = self.request("POST", "/api/ham/userAccount/switchStatus", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error cambiando estado de cuenta: {res.text}")

        return {"success": True, "username": username, "status": status}

    # =========================================================================
    # 2. Company Properties / MACs de Dispositivos (Paso 2)
    # =========================================================================

    def get_company_properties(
        self, page: int = 1, page_size: int = 50, search: Optional[str] = None
    ) -> Dict[str, Any]:
        """Obtiene la lista de dispositivos / MACs registradas en Company Property"""
        payload = {
            "start": "",
            "querySize": page_size * 5 if search else page_size,
            "queryBy": "Account"
        }
        res = self.request("POST", "/api/ham/enterpriseProperty/getAllPageEnterprisePropertyInfo", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error consultando dispositivos de Company Property: {res.text}")

        data = res.json()
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
            "items": paginated_items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": end_idx < total
        }

    def get_company_property_by_mac(self, device_mac: str) -> Optional[Dict[str, Any]]:
        """Busca un registro de Company Property por su dirección MAC"""
        clean_mac = device_mac.replace(":", "").replace("-", "").replace(".", "").upper()
        res = self.get_company_properties(page=1, page_size=1000, search=clean_mac)
        for item in res["items"]:
            if (item.get("deviceMac") or "").upper() == clean_mac:
                return item
        return None

    def add_company_property(self, data: CompanyPropertyCreate) -> Dict[str, Any]:
        """Registra una nueva dirección MAC en Company Property vinculándola a la cuenta"""
        payload = {
            "deviceMac": data.deviceMac,
            "deviceName": data.deviceName or data.employeeAccount or "Dispositivo",
            "account": data.employeeAccount or "",
            "employeeAccount": data.employeeAccount or "",
            "deviceCategory": data.deviceCategory or "Mobile",
            "deviceFamily": data.deviceFamily or "Others",
            "deviceOS": data.deviceOS or "Android",
            "enableDeviceSpecificPSK": data.enableDeviceSpecificPSK or "Disabled",
            "accessRoleProfile": data.accessRoleProfile or "",
            "policyList": data.policyList or "",
            "otherAttributesVOs": []
        }

        res = self.request("POST", "/api/ham/enterpriseProperty/addEnterpriseProperty", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error registrando dispositivo en Company Property: {res.text}")

        res_data = res.json()
        if res_data.get("errorCode", 0) != 0 and res_data.get("result", "").lower() == "fail":
            err_msg = res_data.get("errorMessage", "Error al registrar dispositivo.")
            raise ValueError(f"OmniVista rechazó el registro MAC: {err_msg}")

        return {
            "success": True,
            "deviceMac": data.deviceMac,
            "deviceName": data.deviceName,
            "account": data.employeeAccount,
            "accessRoleProfile": data.accessRoleProfile
        }

    def update_company_property(self, device_mac: str, data: CompanyPropertyUpdate) -> Dict[str, Any]:
        """Modifica un dispositivo registrado en Company Property"""
        clean_mac = device_mac.replace(":", "").replace("-", "").replace(".", "").upper()
        existing = self.get_company_property_by_mac(clean_mac)
        if not existing:
            raise ValueError(f"No se encontró el dispositivo con MAC '{device_mac}'.")

        payload = dict(existing)
        payload["deviceMac"] = clean_mac

        if data.deviceName is not None:
            payload["deviceName"] = data.deviceName
        if data.employeeAccount is not None:
            payload["account"] = data.employeeAccount
        if data.deviceCategory is not None:
            payload["deviceCategory"] = data.deviceCategory
        if data.deviceFamily is not None:
            payload["deviceFamily"] = data.deviceFamily
        if data.deviceOS is not None:
            payload["deviceOS"] = data.deviceOS
        if data.enableDeviceSpecificPSK is not None:
            payload["enableDeviceSpecificPSK"] = data.enableDeviceSpecificPSK
        if data.accessRoleProfile is not None:
            payload["accessRoleProfile"] = data.accessRoleProfile
        if data.policyList is not None:
            payload["policyList"] = data.policyList

        res = self.request("POST", "/api/ham/enterpriseProperty/editEnterpriseProperty", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error modificando Company Property: {res.text}")

        return {"success": True, "deviceMac": clean_mac}

    def delete_company_property(self, device_mac: str) -> Dict[str, Any]:
        """Da de baja / elimina una dirección MAC de Company Property"""
        clean_mac = device_mac.replace(":", "").replace("-", "").replace(".", "").upper()
        
        # OmniVista espera una lista de strings con las MACs: ["0C71657A5645"]
        payload = [clean_mac]
        res = self.request("POST", "/api/ham/enterpriseProperty/deleteEnterpriseProperty", json=payload, timeout=12)
        if res.status_code != 200:
            raise RuntimeError(f"Error eliminando Company Property: {res.text}")

        return {"success": True, "deviceMac": clean_mac}

    # =========================================================================
    # 3. Flujo Unificado de Alta Completa (Paso 1 + Paso 2 en 1 Solo Endpoint)
    # =========================================================================

    def enroll_complete_user(self, data: CompleteEnrollmentRequest) -> CompleteEnrollmentResponse:
        """
        Ejecuta el flujo completo de alta:
        1. Crea la cuenta de empleado (Employee Account)
        2. Registra y vincula la dirección MAC (Company Property)
        """
        # 1. Crear cuenta de empleado
        emp_create = EmployeeCreate(
            username=data.username,
            password=data.password,
            repeatPassword=data.repeatPassword,
            fullName=data.fullName,
            telephone=data.telephone,
            email=data.email,
            department=data.department,
            position=data.position,
            description=data.description,
            accessRoleProfile=data.accessRoleProfile,
            policyList=data.policyList,
            status=1
        )
        emp_res = self.create_employee_account(emp_create)

        # 2. Registrar MAC en Company Property
        prop_create = CompanyPropertyCreate(
            deviceMac=data.deviceMac,
            deviceName=data.deviceName or data.username,
            employeeAccount=data.username,
            deviceCategory=data.deviceCategory or "Mobile",
            deviceFamily=data.deviceFamily or "Others",
            deviceOS=data.deviceOS or "Android",
            enableDeviceSpecificPSK=data.enableDeviceSpecificPSK or "Disabled",
            accessRoleProfile=data.accessRoleProfile,
            policyList=data.policyList,
            description=data.description
        )
        prop_res = self.add_company_property(prop_create)

        return CompleteEnrollmentResponse(
            employeeCreated=True,
            deviceMacRegistered=True,
            username=data.username,
            deviceMac=data.deviceMac,
            accessRoleProfile=data.accessRoleProfile,
            details={
                "employee": emp_res,
                "companyProperty": prop_res
            }
        )

    # =========================================================================
    # 4. Catálogos y Perfiles de Red (Para Dropdowns de Frontend)
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
        """Devuelve las opciones estándar para los dropdowns de categorías y sistemas operativos"""
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

    # =========================================================================
    # 5. Monitoreo y Sesiones en Vivo
    # =========================================================================

    def get_devices(self) -> List[Dict[str, Any]]:
        """Lista completa de switches y APs en la red"""
        res = self.request("GET", "/api/devices", timeout=12)
        if res.status_code == 200:
            data = res.json()
            return data.get("response", [])
        return []

    def get_online_devices(self) -> List[Dict[str, Any]]:
        """Lista de dispositivos de Company Property actualmente autenticados y online"""
        payload = {"start": "", "querySize": 100, "queryBy": "Account"}
        res = self.request("POST", "/api/ham/radius/onlineDevice/getPageEnterprisePropertyOnlineDeviceList", json=payload, timeout=8)
        if res.status_code == 200:
            data = res.json()
            return data.get("data", [])
        return []

    def get_infrastructure_stats(self) -> Dict[str, Any]:
        """Calcula el resumen de dispositivos de red y cuentas registradas"""
        devices = self.get_devices()
        aps_count = sum(1 for d in devices if "AP" in (d.get("model") or d.get("chassisType") or d.get("sysName") or ""))
        switches_count = sum(1 for d in devices if "AOS" in (d.get("model") or d.get("chassisType") or "") or "IDF" in (d.get("sysName") or ""))
        other_devices = len(devices) - (aps_count + switches_count)

        emp_count = self.get_employee_accounts(page=1, page_size=1).get("total", 0)
        mac_count = self.get_company_properties(page=1, page_size=1).get("total", 0)

        return {
            "totalDevices": len(devices),
            "accessPointsCount": aps_count,
            "switchesCount": switches_count,
            "otherDevicesCount": max(0, other_devices),
            "registeredEmployeesCount": emp_count,
            "registeredMacsCount": mac_count
        }

    # =========================================================================
    # 6. Diagnóstico y Salud
    # =========================================================================

    def health_check(self) -> Dict[str, Any]:
        """Prueba de conectividad y salud del enlace con OmniVista"""
        start = time.time()
        connected = False
        message = ""
        try:
            connected = self.login()
            elapsed_ms = round((time.time() - start) * 1000, 2)
            message = "Conexión exitosa con OmniVista 2500" if connected else "Credenciales o login fallido"
        except Exception as e:
            elapsed_ms = round((time.time() - start) * 1000, 2)
            message = f"Error de enlace: {str(e)}"

        return {
            "status": "healthy" if connected else "unhealthy",
            "omnivista_host": self.base_url,
            "omnivista_connected": connected,
            "latency_ms": elapsed_ms,
            "message": message
        }


# Instancia singleton del servicio
omnivista_service = OmniVistaService()
