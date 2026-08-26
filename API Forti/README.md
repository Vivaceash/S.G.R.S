# API de Integración y Monitoreo con Fortinet FortiGate

API REST desarrollada con **FastAPI** y **Scalar**, optimizada para operar en el **puerto 8001** (independiente de tu API en el puerto 8000) para visualización y monitoreo seguro de dispositivos, tráfico, sesiones en vivo y estado general de appliances FortiGate con FortiOS.

---

## 🚀 Inicio Rápido

### 1. Instalar Dependencias
```bash
pip install -r requirements.txt
```

### 2. Configurar Variables de Entorno
Edita el archivo `.env` con los datos de tu FortiGate y tu clave de seguridad:
```ini
# Configuración del servidor (Puerto 8001)
PORT=8001
HOST=0.0.0.0

# Seguridad de nuestra API (Cabecera X-API-Key obligatoria para clientes)
APP_API_KEY=forti-secret-api-key-change-me

# Conexión con FortiGate
FORTIOS_HOST=192.168.1.1
FORTIOS_PORT=443
FORTIOS_SCHEME=https
FORTIOS_API_TOKEN=PEGA_AQUI_TU_API_TOKEN_DE_FORTIGATE
FORTIOS_DEFAULT_VDOM=root
FORTIOS_VERIFY_SSL=false
```

### 3. Iniciar el Servidor
```bash
python run.py
```
O directamente con Uvicorn:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

---

## 📖 Documentación Interactiva (Scalar)

Una vez iniciado el servidor, abre en tu navegador:
- **Scalar UI**: [http://localhost:8001/scalar](http://localhost:8001/scalar)
- **Docs**: [http://localhost:8001/docs](http://localhost:8001/docs) (redirige a Scalar)

---

## 🛡️ Autenticación y Seguridad

Para proteger la API contra accesos no autorizados e inyecciones:
1. **Autenticación `X-API-Key`**:
   Envía la cabecera HTTP en cada petición:
   ```http
   X-API-Key: forti-secret-api-key-change-me
   ```
2. **Rate Limiting**: Protección integrada con límite de peticiones por minuto para prevenir saturación o DoS.
3. **Cabeceras de Seguridad**: Middleware que inyecta `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection` y `Referrer-Policy`.

---

## 📡 Resumen de Endpoints Disponibles

### 🔍 Dispositivos Conectados e Inventario
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/devices` | Lista todos los dispositivos conectados (MAC, IP, Fabricante, OS, Hostname, Interfaz). Soporta filtros `online_only`, `vendor`, `search`. |
| `GET` | `/api/v1/devices/{mac_or_ip}` | Detalle profundo de un dispositivo por dirección MAC o IP. |

### 🌐 Tráfico, Sesiones y Sitios Visitados
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/traffic/sessions` | Sesiones de tráfico en tiempo real (IP origen, IP destino, puertos, protocolo, bytes). |
| `GET` | `/api/v1/traffic/destinations` | Top de destinos, sitios y servidores más visitados. |
| `GET` | `/api/v1/traffic/logs` | Registros históricos de tráfico y filtro web. |

### 📊 Sistema y Recursos
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/system/status` | Hostname, número de serie, versión de FortiOS, uptime y modo HA. |
| `GET` | `/api/v1/system/resources` | Consumo de CPU %, Memoria RAM %, Disco % y conteo de sesiones. |
| `GET` | `/api/v1/system/firmware` | Versión y particiones de firmware. |

### 🔌 Red, DHCP e Interfaces
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/network/dhcp-leases` | Concesiones DHCP activas y tiempos de expiración. |
| `GET` | `/api/v1/network/arp-table` | Tabla de resolución de vecinos ARP. |
| `GET` | `/api/v1/network/interfaces` | Estado de puertos físicos y consumo de ancho de banda. |

### 🧱 Firewall y Políticas
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/firewall/policies` | Lista de políticas y reglas de tráfico. |
| `GET` | `/api/v1/firewall/addresses` | Objetos de dirección IP (Address Objects). |
| `GET` | `/api/v1/firewall/address-groups` | Grupos de direcciones (Address Groups). |

### 🔐 VPN
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/vpn/ipsec` | Estado de túneles IPsec (Up/Down, bytes). |
| `GET` | `/api/v1/vpn/ssl-sessions` | Usuarios conectados activamente a SSL-VPN. |

### 🩺 Salud
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/health` | Estado de la API y test de conectividad con FortiGate (no requiere API Key). |
