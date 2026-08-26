# S.G.R.S. — Sistema de Gestión de Redes y Seguridad

Plataforma integral para el monitoreo, control de acceso y gestión centralizada de infraestructura de red y seguridad.

---

## 🏛️ Arquitectura del Proyecto

El repositorio está estructurado en tres componentes principales:

```text
SGRS/
├── API Forti/      # Microservicio FastAPI para Fortinet FortiGate (Puerto 8001)
├── API Omni/       # Microservicio FastAPI para Alcatel-Lucent OmniVista 2500 (Puerto 8000)
├── Dashboard/      # Frontend navegable de monitoreo (HTML5 / Modern CSS / Vanilla JS)
└── .gitignore      # Protección contra fuga de credenciales, API keys y caches
```

---

## 📦 Componentes

### 1. 🛡️ API Fortinet FortiGate (`API Forti/`)
Microservicio desarrollado con **FastAPI** y documentación interactiva **Scalar** para monitoreo y consulta de appliances FortiGate con FortiOS.
- **Puerto por defecto:** `8001`
- **Funcionalidades:**
  - Inventario de dispositivos conectados (MAC, IP, Vendor, OS).
  - Sesiones de tráfico en tiempo real, destinos y logs de navegación.
  - Métricas de sistema (CPU, RAM, Uptime, Cluster HA).
  - Estado de interfaces de red, concesiones DHCP y tablas ARP.
  - Políticas de firewall, objetos de dirección y túneles VPN (IPsec / SSL).
- **Seguridad:** Autenticación por cabecera `X-API-Key`, Rate Limiting con SlowAPI y cabeceras de seguridad HTTP.

### 2. 🌐 API Alcatel OmniVista 2500 (`API Omni/`)
Microservicio desarrollado con **FastAPI** y documentación **Scalar** para interactuar con la REST API de Alcatel-Lucent OmniVista 2500 NMS.
- **Puerto por defecto:** `8000`
- **Funcionalidades:**
  - Alta unificada de empleados y enrolamiento de direcciones MAC (`/api/v1/enrollment/complete-user`).
  - Gestión completa (CRUD) de cuentas de empleados en OmniVista UPAM.
  - Gestión (CRUD) de direcciones MAC en Company Property.
  - Catálogos de redes (SSIDs) y categorías de dispositivos.
  - Monitoreo de switches y Access Points (APs).
- **Pruebas:** Suite de pruebas con Pytest en `API Omni/tests/`.

### 3. 📊 Dashboard de Monitoreo (`Dashboard/`)
Centro de control visual diseñado sin dependencias externas (Zero-Dependency Vanilla JS, CSS3 responsive y accesible).
- Visualización de estado general y ruta de señal en vivo.
- Métricas clave: conteo de dispositivos, consumo de direccionamiento IPv4 por segmento, ancho de banda y alertas activas.
- Tabla de inventario con búsqueda en tiempo real, ordenamiento dinámico y filtros por estado.
- Bitácora de movimientos (altas, bajas y modificaciones).

---

## 🚀 Puesta en Marcha

### Prerrequisitos
- Python 3.11+
- Git

### Configuración de Entorno
Cada microservicio cuenta con su archivo de plantilla `.env.example`. Crea un archivo `.env` en cada carpeta correspondiente antes de ejecutar:

1. **API Fortinet:**
   ```bash
   cd "API Forti"
   copy .env.example .env
   # Configura tu IP de FortiGate y tu FORTIOS_API_TOKEN
   pip install -r requirements.txt
   python run.py
   ```

2. **API OmniVista:**
   ```bash
   cd "API Omni"
   copy .env.example .env
   # Configura tu IP de OmniVista, OV_API_KEY o credenciales de admin
   pip install -r requirements.txt
   python run.py
   ```

3. **Dashboard:**
   Abre directamente `Dashboard/index.html` en tu navegador o levanta un servidor estático local:
   ```bash
   python -m http.server 3000 --directory Dashboard
   ```

---

## 🔒 Seguridad
- **Nunca subas archivos `.env` ni claves privadas al repositorio.**
- El archivo `.gitignore` centralizado bloquea automáticamente tokens, API keys, credenciales y archivos de depuración interna.
