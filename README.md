# S.G.R.S. — Sistema de Gestión de Redes y Seguridad

> **Plataforma centralizada de observabilidad, telemetría perimetral, inventario de infraestructura y control de acceso para redes corporativas de misión crítica.**

---

## 🏛️ Arquitectura del Sistema

El ecosistema **S.G.R.S.** está diseñado bajo una arquitectura desacoplada de microservicios complementarios y un centro de visualización moderno sin dependencias externas:

```text
                               ┌────────────────────────────────────────┐
                               │       Administrador / Operador         │
                               └───────────────────┬────────────────────┘
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
              ┌─────────────────────┐                             ┌─────────────────────┐
              │  Dashboard Web UI   │                             │   Herramientas CLI  │
              │  (Vanilla JS / CSS) │                             │   (run.py / tests)  │
              │     Puerto 3000     │                             └──────────┬──────────┘
              └──────────┬──────────┘                                        │
                         │                                                   │
        ┌────────────────┴───────────────────────────────────────────────────┴────────────────┐
        ▼                                                                                     ▼
┌───────────────────────────────────────┐                           ┌───────────────────────────────────────┐
│     Microservicio API Fortinet        │                           │     Microservicio API OmniVista       │
│  FastAPI (Asíncrono / Puerto 8001)    │                           │  FastAPI (Solo Lectura / Puerto 8000) │
│  - Cabeceras de Seguridad OWASP       │                           │  - Cabeceras de Seguridad OWASP       │
│  - Rate Limiter (Ventana Deslizante)  │                           │  - Rate Limiter (Ventana Deslizante)  │
│  - Anti-DoS Body Limit (1 MB)         │                           │  - Anti-DoS Body Limit (1 MB)         │
│  - Inyección de X-Request-ID          │                           │  - Inyección de X-Request-ID          │
│  - Autenticación Dual (Key / Bearer)  │                           │  - Autenticación Dual (Key / Bearer)  │
│  - Enmascaramiento de IPs y Secretos  │                           │  - Enmascaramiento de IPs y Secretos  │
│  - Liveness Probe (/health)           │                           │  - Liveness Probe (/health)           │
│  - Docs Interactivas (/scalar)        │                           │  - Docs Interactivas (/scalar)        │
└──────────────────┬────────────────────┘                           └──────────────────┬────────────────────┘
                   │ HTTPS (Token Bearer / TLS)                                        │ HTTPS (Token / API Key)
                   ▼                                                                   ▼
┌───────────────────────────────────────┐                           ┌───────────────────────────────────────┐
│       Appliance FortiGate             │                           │       NMS Alcatel-Lucent              │
│       FortiOS v7.4.5                  │                           │       OmniVista 2500                  │
│  - Inventario de Clientes Conectados  │                           │  - Switches OmniSwitch y APs Stellar  │
│  - Tráfico y Destinos en Tiempo Real  │                           │  - Cuentas de Empleados UPAM          │
│  - Métricas de CPU, RAM y Sesiones    │                           │  - Terminales de Company Property     │
│  - Concesiones DHCP y Tablas ARP      │                           │  - Catálogos de Redes (SSIDs / VLANs) │
│  - Políticas de Firewall y Túneles VPN│                           │  - Alarmas y Notificaciones de Red    │
└───────────────────────────────────────┘                           └───────────────────────────────────────┘
```

---

## 📦 Componentes del Ecosistema

### 1. 🛡️ API Fortinet FortiGate (`API Forti/`)
Microservicio asíncrono de alto rendimiento desarrollado con **FastAPI** y cliente **HTTPX** con agrupación de conexiones (*connection pooling*) para interactuar directamente con la API REST de FortiOS (FortiGate).

- **Puerto Predeterminado:** `8001`
- **Documentación Interactiva Scalar:** `http://localhost:8001/scalar` o `/docs`
- **Liveness Probe Público:** `http://localhost:8001/health`
- **Diagnóstico Profundo Autenticado:** `http://localhost:8001/api/v1/health`

#### Catálogo de Endpoints de API Forti:
| Módulo | Método | Endpoint | Descripción |
| :--- | :---: | :--- | :--- |
| **Salud** | `GET` | `/health` | Liveness probe público ligero para balanceadores (sin consumo de red). |
| **Salud** | `GET` | `/api/v1/health` | Diagnóstico autenticado de conectividad con FortiGate, uptime y estado. |
| **Dispositivos** | `GET` | `/api/v1/devices` | Lista completa de dispositivos conectados (MAC, IP, Vendor, OS, hostname). |
| **Dispositivos** | `GET` | `/api/v1/devices/{mac_address}` | Consulta específica de un dispositivo por su dirección física MAC. |
| **Dispositivos** | `GET` | `/api/v1/devices/summary` | Conteo consolidado de dispositivos totales, online y offline. |
| **Tráfico** | `GET` | `/api/v1/traffic/sessions` | Sesiones de tráfico de red activas en tiempo real con filtros por IP/puerto. |
| **Tráfico** | `GET` | `/api/v1/traffic/destinations` | Top de los 25 destinos web/IPs más visitados por los clientes de la red. |
| **Tráfico** | `GET` | `/api/v1/traffic/logs` | Registros históricos de navegación y tráfico almacenados en FortiOS. |
| **Sistema** | `GET` | `/api/v1/system/status` | Hostname, número de serie (enmascarado), versión de FortiOS y uptime. |
| **Sistema** | `GET` | `/api/v1/system/resources` | Consumo porcentual de CPU, memoria RAM y conteo de sesiones concurrentes. |
| **Sistema** | `GET` | `/api/v1/system/firmware` | Información detallada de particiones de arranque y versión de firmware. |
| **Red & DHCP** | `GET` | `/api/v1/network/interfaces` | Estado de interfaces físicas, virtuales y VLANs (enlace UP/DOWN, bytes tx/rx). |
| **Red & DHCP** | `GET` | `/api/v1/network/dhcp-leases` | Concesiones de direccionamiento IP activas otorgadas por el servidor DHCP. |
| **Red & DHCP** | `GET` | `/api/v1/network/arp-table` | Tabla de resolución de direcciones ARP del appliance. |
| **Firewall** | `GET` | `/api/v1/firewall/policies` | Reglas y políticas de filtrado de paquetes configuradas en el firewall. |
| **Firewall** | `GET` | `/api/v1/firewall/addresses` | Objetos de dirección IP, FQDN y rangos definidos para políticas. |
| **Firewall** | `GET` | `/api/v1/firewall/address-groups` | Grupos lógicos de objetos de dirección de firewall. |
| **VPNs** | `GET` | `/api/v1/vpn/ipsec` | Estado operacional de túneles VPN IPsec sitio a sitio. |
| **VPNs** | `GET` | `/api/v1/vpn/ssl-sessions` | Usuarios y túneles activos autenticados en el portal SSL-VPN. |

---

### 2. 🌐 API Alcatel-Lucent OmniVista 2500 (`API Omni/`)
Microservicio estructurado con **FastAPI** y **Scalar** en su versión **v2.0**, transformado en un motor de **solo lectura, auditoría y telemetría**.

> **Nota Arquitectónica (v2.0):** Para salvaguardar la integridad de la infraestructura de red corporativa y cumplir con políticas estrictas de seguridad de la información, se deshabilitaron las operaciones de mutación directa (`POST`, `PUT`, `DELETE`). La API se enfoca exclusivamente en visibilidad, inventario en tiempo real y detección de incidencias.

- **Puerto Predeterminado:** `8000`
- **Documentación Interactiva Scalar:** `http://localhost:8000/scalar` o `/docs`
- **Liveness Probe Público:** `http://localhost:8000/health`
- **Diagnóstico Profundo Autenticado:** `http://localhost:8000/api/v1/system/health`

#### Catálogo de Endpoints de API Omni:
| Módulo | Método | Endpoint | Descripción |
| :--- | :---: | :--- | :--- |
| **Salud** | `GET` | `/health` | Liveness probe público ligero para orquestadores de contenedores. |
| **Diagnóstico** | `GET` | `/api/v1/system/health` | Estado de enlace y latencia contra el servidor OmniVista 2500 NMS. |
| **Diagnóstico** | `GET` | `/api/v1/system/version` | Versión y número de compilación del sistema operativo del NMS. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/infrastructure-stats` | Resumen métrico consolidado: total de APs, Switches, cuentas y MACs. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/devices` | Inventario de conmutadores (OmniSwitch) y APs (Stellar) con IP y modelo. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/devices/{ip_address}` | Búsqueda y telemetría de un equipo de red por su IP de gestión. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/online-devices` | Dispositivos y clientes de Company Property conectados en vivo a la red. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/topology` | Mapa de topología y enlaces lógicos entre switches y puntos de acceso. |
| **Monitoreo** | `GET` | `/api/v1/monitoring/notifications` | Registro de eventos, alarmas y trampas activas del NMS OmniVista. |
| **Empleados** | `GET` | `/api/v1/employees` | Directorio paginado de usuarios UPAM con búsqueda libre por texto. |
| **Empleados** | `GET` | `/api/v1/employees/{username}` | Detalle de la cuenta de acceso de un empleado (perfil de rol, vigencia). |
| **Company Property** | `GET` | `/api/v1/company-properties` | Dispositivos autorizados en Company Property con búsqueda y paginación. |
| **Company Property** | `GET` | `/api/v1/company-properties/{device_mac}` | Consulta técnica de un dispositivo por su dirección MAC normalizada. |
| **Catálogos** | `GET` | `/api/v1/catalogs/access-role-profiles` | Catálogo de perfiles de red inalámbrica y políticas de acceso (SSIDs). |
| **Catálogos** | `GET` | `/api/v1/catalogs/device-options` | Categorías de dispositivos, familias y sistemas operativos registrados. |
| **Catálogos** | `GET` | `/api/v1/catalogs/vlans` | Catálogo de VLANs y segmentos de red configurados en los conmutadores. |

---

### 3. 📊 Dashboard de Monitoreo (`Dashboard/`)
Centro de control visual moderno para operadores de red desarrollado desde cero con **React 19**, **TypeScript**, **Vite** y **Tailwind CSS v4** bajo la estética NOC Console (paleta azul carbón `#071018`, superficie `#0e1c28`, acentos cyan/signal `#34d5e7`).

- **Puerto Predeterminado:** `5173` (autorizado en la lista blanca de CORS del backend)
- **Características:**
  - **Indicadores Clave en Tiempo Real:** Total de equipos en línea vs inventario, capacidad de direccionamiento IPv4 (concesiones DHCP), consumo de hardware (CPU %, Memoria RAM % y sesiones concurrentes de FortiGate) y notificaciones activas de OmniVista.
  - **Ruta de Señal Visual:** Diagrama interactivo de salud entre Internet, Firewall perimetral, Núcleo (OmniVista) y switches de Acceso con latencia y versiones.
  - **Tabla de Inventario de Alto Rendimiento:** Soporte fluido para **+3,300 dispositivos**, búsqueda reactiva instantánea (por nombre, IP, MAC o fabricante), filtros segmentados de estado (*Todos*, *En línea*, *Fuera de línea*, *Switches & APs*), paginación y **exportación a CSV**.
  - **Inspector de Telemetría Técnica:** Modal deslizable para inspeccionar parámetros técnicos de cualquier dispositivo al hacer clic en su fila, con copiado rápido de IP y MAC al portapapeles.
  - **Configuración de Enlace Dinámica:** Diálogo para modificar URLs de backend y credencial `X-API-Key` en vivo con prueba de conectividad de enlaces.
  - **Distribución de Capacidad IPv4 y Bitácora:** Gráficas de barra con el consumo de direccionamiento por VLAN y bitácora de eventos en tiempo real.

---

## 🔒 Marco de Seguridad Defensiva OWASP

Ambos microservicios implementan una pila de seguridad multicapa para mitigar riesgos del **OWASP API Security Top 10**:

```text
[ Cliente HTTP / Frontend ]
           │
           ▼
[ 1. SecurityHeadersMiddleware ] ──> Inyecta HSTS, CSP estricto, Cache-Control: no-store, nosniff, DENY
           │
           ▼
[ 2. RequestSizeLimitMiddleware ] ──> Rechaza solicitudes mayores a 1 MB con HTTP 413 (Anti-DoS)
           │
           ▼
[ 3. RateLimitingMiddleware ] ──> Ventana deslizante (Sliding Window): 60-120 req/min por IP (HTTP 429)
           │
           ▼
[ 4. RequestContextMiddleware ] ──> Genera / propaga X-Request-ID (UUIDv4) en logs y respuestas
           │
           ▼
[ 5. Control de Acceso Dual ] ──> Autenticación constante contra timing attacks (X-API-Key / Bearer)
           │
           ▼
[ 6. Sanitizador y Enmascaramiento ] ──> Oculta IPs privadas, seriales y purga secretos/PSK
           │
           ▼
[ Endpoints del Backend ]
```

1. **Cabeceras HTTP de Seguridad (OWASP)**:
   - `X-Content-Type-Options: nosniff` (previene ataques de interpretación MIME).
   - `X-Frame-Options: DENY` (neutraliza ataques de clickjacking).
   - `X-XSS-Protection: 0` (desactiva filtros obsoletos del navegador en favor de CSP).
   - `Referrer-Policy: strict-origin-when-cross-origin` (protege la privacidad de URLs).
   - `Permissions-Policy` restrictivo (bloquea acceso a geolocalización, cámara y micrófono).
   - `Cache-Control: no-store, no-cache, must-revalidate` en todas las rutas `/api/*` (impide que proxies o navegadores almacenen telemetría de red sensible).
   - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` en respuestas JSON de API.
   - `Strict-Transport-Security (HSTS)` forzado en comunicaciones sobre HTTPS.

2. **Control de Tasa por Ventana Deslizante (*Sliding Window Rate Limiting*)**:
   - Algoritmo implementado en memoria protegido por bloqueos de hilo (`threading.Lock`).
   - Extracción de dirección IP real contemplando balanceadores y proxies (`X-Forwarded-For`, `X-Real-IP`).
   - Purga periódica automática de IPs inactivas para prevenir fugas de memoria (*memory leaks*).
   - Respuestas estándar HTTP `429 Too Many Requests` acompañadas de cabeceras RFC: `Retry-After`, `X-RateLimit-Limit` y `X-RateLimit-Remaining`.

3. **Protección Anti-DoS por Tamaño de Petición (`RequestSizeLimitMiddleware`)**:
   - Inspección previa de la cabecera `Content-Length`. Si una petición supera el límite permitido (1 MB por defecto), se rechaza de inmediato con HTTP `413 Payload Too Large`.

4. **Trazabilidad y Correlación de Solicitudes (`RequestContextMiddleware`)**:
   - Asignación de un identificador único criptoseguro `X-Request-ID` (UUIDv4) por cada solicitud.
   - Propagación automática en cabeceras de respuesta y en los mensajes del logger de auditoría para trazabilidad en sistemas SIEM.

5. **Autenticación Multi-Llave y Resistencia a *Timing Attacks***:
   - Admite listas de claves separadas por coma en `APP_API_KEY`, facilitando la **rotación de credenciales en producción sin tiempo de inactividad**.
   - Validación mediante `secrets.compare_digest`, mitigando ataques de análisis de tiempo de respuesta (*timing attacks*).
   - Acepta credenciales a través de cabeceras alternativas: `X-API-Key`, `X-API-KEY` o cabecera estándar `Authorization: Bearer <token>`.

6. **Enmascaramiento y Sanitización Automática de Datos Sensibles**:
   - Función `mask_sensitive_ip`: Oculta el último octeto de direcciones IPv4 privadas en respuestas públicas (ej. `192.168.10.***`).
   - Función `_mask_serial`: Enmascara números de serie de appliances físicos (ej. `FGT****210`).
   - Módulo `sanitize_data`: Purga recursivamente de las respuestas cualquier campo que contenga contraseñas, secretos o claves precompartidas IPsec/WPA (`psk`, `psksecret`, `userPassword`, `devicePSK`, `private_key`).

7. **Jerarquía Centralizada de Excepciones y Resiliencia**:
   - Errores de red con appliances externos se transforman en códigos semánticos:
     - `OmniVistaConnectionError` / `FortiOSConnectionError` $\rightarrow$ HTTP `503 Service Unavailable`.
     - `OmniVistaAuthError` $\rightarrow$ HTTP `502 Bad Gateway`.
     - `OmniVistaNotFoundError` $\rightarrow$ HTTP `404 Not Found`.
   - Previene la fuga de trazas internas (*stack traces*) hacia clientes externos cuando el entorno es de producción.

---

## ⚙️ Configuración de Entorno (.env)

Cada microservicio se configura mediante variables de entorno validadas con **Pydantic Settings**:

### Variables para API Fortinet (`API Forti/.env`)
| Variable | Tipo | Valor Predeterminado | Descripción |
| :--- | :---: | :---: | :--- |
| `APP_NAME` | `str` | `Fortinet FortiGate REST Integration API` | Nombre descriptivo del microservicio. |
| `PORT` | `int` | `8001` | Puerto de escucha HTTP del servidor. |
| `ENVIRONMENT` | `str` | `development` | Entorno de ejecución (`development` o `production`). |
| `APP_API_KEY` | `str` | `admin` | Clave(s) de acceso API. Admite múltiples separadas por coma. |
| `ALLOW_UNAUTHENTICATED` | `bool` | `false` | Si es `true`, omite autenticación (solo desarrollo). |
| `RATE_LIMIT_PER_MINUTE` | `int` | `120` | Máximo de peticiones permitidas por minuto por IP. |
| `MAX_REQUEST_BODY_BYTES` | `int` | `1048576` | Tamaño máximo permitido del cuerpo HTTP (1 MB). |
| `CORS_ORIGINS` | `str` | `http://localhost:5173,http://localhost:3000` | Orígenes web autorizados para interactuar vía CORS. |
| `ENABLE_DOCS` | `bool` | `true` | Habilita o deshabilita la interfaz interactiva Scalar. |
| `MASK_INTERNAL_IPS` | `bool` | `true` | Enmascara IPs y datos sensibles en endpoints de salud. |
| `FORTIOS_HOST` | `str` | `192.168.1.1` | Dirección IP o FQDN del appliance FortiGate. |
| `FORTIOS_PORT` | `int` | `443` | Puerto HTTPS de administración de FortiOS. |
| `FORTIOS_SCHEME` | `str` | `https` | Protocolo de conexión con FortiGate. |
| `FORTIOS_API_TOKEN` | `str` | `""` | Token REST API generado en FortiOS (`Administrators`). |
| `FORTIOS_DEFAULT_VDOM` | `str` | `root` | VDOM principal de consulta en FortiGate. |
| `FORTIOS_VERIFY_SSL` | `bool` | `false` | Valida certificados TLS de FortiGate. |
| `FORTIOS_CA_BUNDLE` | `str` | `""` | Ruta a certificado CA corporativo si aplica. |
| `FORTIOS_TIMEOUT` | `float` | `15.0` | Tiempo de espera en segundos para respuestas de FortiOS. |

### Variables para API OmniVista (`API Omni/.env`)
| Variable | Tipo | Valor Predeterminado | Descripción |
| :--- | :---: | :---: | :--- |
| `SERVER_HOST` | `str` | `0.0.0.0` | Dirección de enlace del servidor FastAPI. |
| `SERVER_PORT` | `int` | `8000` | Puerto de escucha HTTP del servidor. |
| `ENVIRONMENT` | `str` | `development` | Entorno de ejecución (`development` o `production`). |
| `APP_API_KEY` | `str` | `admin` | Clave(s) de acceso API. Admite múltiples separadas por coma. |
| `ALLOW_UNAUTHENTICATED` | `bool` | `false` | Omite validación de API Key si es `true`. |
| `RATE_LIMIT_PER_MINUTE` | `int` | `60` | Máximo de peticiones permitidas por minuto por IP. |
| `MAX_REQUEST_BODY_BYTES` | `int` | `1048576` | Límite máximo de payload recibido (1 MB). |
| `CORS_ORIGINS` | `str` | `http://localhost:5173,http://localhost:3000` | Orígenes web habilitados para consumo de la API. |
| `ENABLE_DOCS` | `bool` | `true` | Control de visibilidad de la documentación Scalar. |
| `MASK_INTERNAL_IPS` | `bool` | `true` | Enmascara IPs en respuestas de estado de salud. |
| `OV_HOST` | `str` | `192.168.10.201` | Dirección IP del servidor Alcatel OmniVista 2500 NMS. |
| `OV_PORT` | `int` | `443` | Puerto de comunicación con OmniVista. |
| `OV_PROTOCOL` | `str` | `https` | Protocolo hacia el NMS. |
| `OV_USERNAME` | `str` | `admin.red` | Usuario de servicio para sesión de respaldo en OmniVista. |
| `OV_PASSWORD` | `str` | `""` | Contraseña del usuario de servicio. |
| `OV_API_KEY` | `str` | `""` | API Key generada en OmniVista (*External Applications*). |
| `OV_VERIFY_SSL` | `bool` | `false` | Validación estricta de certificados TLS. |
| `OV_CA_BUNDLE` | `str` | `""` | Ruta hacia el certificado CA corporativo. |

---

## 🚀 Puesta en Marcha

### Prerrequisitos
- Python 3.11 o superior instalado.
- Conectividad de red hacia los equipos (FortiGate y OmniVista).
- Git instalado.

### 1. Inicio Rápido Unificado (Recomendado)
Desde la raíz del repositorio, ejecuta el script orquestador:
```powershell
python run.py
```
Este script arrancará automáticamente **los tres servicios en paralelo**:
- **API Alcatel OmniVista 2500** en `http://localhost:8000`
- **API Fortinet FortiGate** en `http://localhost:8001`
- **Dashboard Web (React + Vite)** en `http://localhost:5173`

Con **streaming unificado de logs etiquetados** (`[API-FORTI]`, `[API-OMNI]`, `[DASHBOARD]`). Para detener todos los servicios de forma ordenada, simplemente presiona **`Ctrl + C`** en la consola (el script limpiará el árbol de procesos en Windows mediante `taskkill /F /T` para liberar los puertos de inmediato).

---

### 2. Inicio Individual por Servicio

Si prefieres ejecutar cada servicio en consolas dedicadas:

#### Iniciar API Fortinet (Puerto 8001):
```powershell
cd "API Forti"
copy .env.example .env     # (Solo la primera vez)
pip install -r requirements.txt
python run.py
```

#### Iniciar API OmniVista (Puerto 8000):
```powershell
cd "API Omni"
copy .env.example .env     # (Solo la primera vez)
pip install -r requirements.txt
python run.py
```

#### Iniciar el Dashboard Web (Puerto 5173):
```powershell
cd "Dashboard"
npm install                # (Solo la primera vez)
npm run dev
```
Abre tu navegador en `http://localhost:5173`.

---

## 🧪 Ecosistema de Pruebas Automatizadas

El repositorio cuenta con una suite completa de pruebas unitarias, de seguridad y de integración que validan **43 casos de prueba**:

- **API Forti (29 pruebas):**
  - 13 pruebas de seguridad defensiva: rechazo de solicitudes no autenticadas, tokens inválidos, cabeceras OWASP, rate limiting, liveness probe, inyecciones en parámetros y sanitización de secretos.
  - 16 pruebas de endpoints operativos: validación de respuestas semánticas en interfaces, DHCP, ARP, tráfico, firewall, VPNs y recursos.
- **API Omni (14 pruebas):**
  - Liveness probe público, documentación Scalar, especificación OpenAPI, autenticación con `X-API-KEY` y `Bearer`, cabeceras OWASP, enmascaramiento de IP, rate limiting por ventana deslizante y protección Anti-DoS HTTP 413.

### Ejecutar la Suite Completa Unificada:
```powershell
python run_tests.py
```

### Ejecutar Pruebas por Microservicio:
```powershell
# Pruebas de API Fortinet
python -m pytest "API Forti/tests" -v

# Pruebas de API OmniVista
python -m pytest "API Omni/tests" -v
```

---

## 📁 Estructura del Repositorio

```text
SGRS/
├── API Forti/                      # Microservicio para Fortinet FortiGate
│   ├── app/
│   │   ├── clients/fortios.py      # Cliente asíncrono HTTPX hacia FortiOS REST API
│   │   ├── core/
│   │   │   ├── config.py           # Configuración Pydantic BaseSettings
│   │   │   ├── errors.py           # Jerarquía de excepciones FortiOSBaseException
│   │   │   └── security.py         # Verificación de API keys y rate limiting
│   │   ├── middleware/
│   │   │   └── security.py         # OWASP, Sliding Window, Body Size y Request-ID
│   │   ├── routers/                # Enrutadores: devices, traffic, firewall, system, etc.
│   │   ├── schemas/                # Modelos Pydantic v2 (BaseResponse, métricas, etc.)
│   │   ├── security/
│   │   │   ├── logging.py          # Logger estructurado y enmascarador de IPs
│   │   │   └── sanitizer.py        # Purgador de contraseñas y claves precompartidas
│   │   └── main.py                 # Inicializador FastAPI y manejadores de error
│   ├── tests/                      # Suite de pruebas automatizadas Pytest
│   │   ├── test_api_endpoints.py   # Pruebas de telemetría y endpoints operativos
│   │   └── test_security.py        # Pruebas de validación de seguridad y OWASP
│   ├── .env.example                # Plantilla de variables de entorno
│   ├── requirements.txt            # Dependencias del microservicio
│   └── run.py                      # Punto de entrada local del microservicio
│
├── API Omni/                       # Microservicio para Alcatel OmniVista 2500 (v2.0)
│   ├── app/
│   │   ├── errors.py               # Excepciones especializadas OmniVistaBaseException
│   │   ├── config.py               # Configuración Pydantic Settings con ruta relativa
│   │   ├── dependencies.py         # Inyectores de dependencias y verify_api_key
│   │   ├── middleware/
│   │   │   └── security.py         # OWASP, Rate Limit, Body Size Limit y Request ID
│   │   ├── routers/                # Enrutadores: monitoring, employees, catalogs, system
│   │   ├── schemas/                # Modelos de respuesta y paginación
│   │   ├── security/               # Auditoría y enmascaramiento de IPs internas
│   │   ├── services/
│   │   │   └── omnivista_service.py# Lógica de conexión con OmniVista 2500 NMS
│   │   └── main.py                 # Aplicación FastAPI con probe /health
│   ├── tests/                      # Suite de pruebas automatizadas Pytest
│   │   └── test_api_endpoints.py   # Pruebas completas de endpoints y seguridad
│   ├── .env.example                # Plantilla de variables de entorno
│   ├── requirements.txt            # Dependencias del microservicio
│   └── run.py                      # Punto de entrada local del microservicio
│
├── Dashboard/                      # Frontend navegable de monitoreo
│   ├── app.js                      # Lógica cliente y manipulación del DOM
│   ├── DESIGN.md                   # Especificaciones de diseño y paleta cromática
│   ├── index.html                  # Interfaz gráfica de centro de monitoreo
│   ├── README.md                   # Documentación específica del frontend
│   └── styles.css                  # Estilos visuales modernos y accesibles
│
├── pytest.ini                      # Configuración centralizada de Pytest
├── run.py                          # Orquestador unificado de inicio de microservicios
├── run_tests.py                    # Runner unificado de pruebas con reporte consolidado
├── .gitignore                      # Reglas de exclusión para credenciales y cachés
└── README.md                       # Documentación técnica principal del proyecto
```

---

## 📄 Licencia y Confidencialidad
Este software y su documentación son de uso reservado para la administración, monitoreo y soporte de la infraestructura de redes y seguridad perimetral de la organización.
