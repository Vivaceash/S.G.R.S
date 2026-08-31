# S.G.R.S. — Centro de Monitoreo de Redes y Seguridad (Dashboard)

Frontend moderno desarrollado desde cero con **React 19**, **TypeScript estricto**, **Vite** y **Tailwind CSS v4** para la visualización, inventario y observabilidad de la infraestructura de redes y seguridad.

---

## ⚡ Tecnologías

- **React 19** con Hooks y gestión de estado reactiva.
- **TypeScript** con tipado estricto alineado a los esquemas Pydantic del backend.
- **Vite 6** para compilación ultrarrápida y recarga en caliente (HMR).
- **Tailwind CSS v4** adaptado al sistema de diseño NOC Console (paleta azul carbón `#071018`, superficie `#0e1c28`, acentos cyan/signal `#34d5e7`).
- **Lucide React** para iconografía semántica de hardware, switches, firewalls y telecomunicaciones.

---

## 🚀 Puesta en Marcha

### Prerrequisitos
- Node.js LTS (v24 o superior)
- Las APIs backend encendidas (`API Forti` en puerto 8001 y `API Omni` en puerto 8000)

### Instalación de dependencias (si aplica):
```bash
npm install
```

### Iniciar en modo desarrollo:
```bash
npm run dev
```
La aplicación abrirá en: **`http://localhost:5173`** (puerto autorizado en la lista blanca de CORS del backend).

### Compilar para producción:
```bash
npm run build
```
Genera los archivos estáticos optimizados en la carpeta `dist/`.

---

## 📊 Módulos y Funcionalidades

1. **Ruta de Señal en Vivo (`SignalRoute`):**
   - Muestra visualmente la cadena de enlace: **Internet $\rightarrow$ Firewall (FortiGate) $\rightarrow$ Núcleo (OmniVista) $\rightarrow$ Acceso (Switches / APs)**.
   - Diagnóstico inmediato del estado de la red (Estable / Degradada) con latencia y versiones.
2. **Tarjetas de Métricas en Tiempo Real (`MetricCards`):**
   - Dispositivos activos vs totales con barra de progreso porcentual.
   - Capacidad y uso de direccionamiento IPv4 (concesiones DHCP).
   - Consumo de hardware del firewall (CPU %, Memoria RAM % y conteo de sesiones en vivo).
   - Conteo y desglose de alertas activas del NMS OmniVista.
3. **Tabla de Inventario de Alta Capacidad (`DeviceTable`):**
   - Diseñada para renderizar suavemente inventarios de **+3,300 dispositivos**.
   - Búsqueda reactiva instantánea por Nombre, Dirección IP, Dirección MAC, Fabricante o Interfaz.
   - Filtros segmentados: *Todos*, *En línea*, *Fuera de línea*, *Switches y APs*.
   - Ordenamiento multidireccional por columna.
   - Paginación dinámica (50 equipos por página).
   - Exportación del inventario filtrado a formato **CSV** con un solo clic.
4. **Inspector de Telemetría Técnica (`DeviceDetailModal`):**
   - Modal deslizable que muestra todos los parámetros técnicos de un equipo al hacer clic en su fila (IP, MAC, Fabricante, Interfaz, Origen de detección FortiOS/OmniVista).
   - Copiado rápido de IP y MAC al portapapeles.
5. **Paneles Laterales:**
   - **Bitácora de Red (`ActivityFeed`):** Eventos y notificaciones en tiempo real.
   - **Capacidad IPv4 (`CapacityPanel`):** Barras de consumo por VLAN (Corporativo, Operaciones, Invitados, Infraestructura).
6. **Configuración Dinámica (`ConfigModal`):**
   - Permite al operador cambiar las URLs de las APIs y la clave `X-API-Key` directamente desde la interfaz, con botón para **Probar Enlaces** en vivo sin recargar el navegador.
