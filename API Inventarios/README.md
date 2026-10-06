# SGRS — API Inventarios

Servicio FastAPI independiente para inventario CCTV, correcciones, cotejo de red e información VLAN de FortiGate. Incluye documentación Scalar en `/docs` y `/scalar`, OpenAPI configurable y base SQLite privada.

## Inicio local

Desde la raíz, `python run.py` inicia OmniVista en `8000`, FortiGate en `8001`, Inventarios en `8002` y el dashboard. El primer inicio crea claves aleatorias en `API Inventarios/.private/.env` y una credencial privada para el proxy del dashboard. Cada servicio también se puede iniciar desde esta carpeta con `python run.py`. No se imprimen claves en consola.

Entra a `http://localhost:8002/scalar` para explorar los contratos. La clave de lectura, escritura y exportación se puede obtener localmente de `.private/.env` para herramientas autorizadas. Mantén ese archivo protegido y no lo compartas. Para producción, proporciona el conjunto completo `INVENTARIOS_*` desde el gestor de secretos y reemplaza las claves locales. El servidor escucha en loopback por defecto; la publicación requiere un proxy TLS y los hosts/orígenes permitidos explícitos.

El dashboard administra la credencial de su conexión Inventarios en **Conexiones API**. La API obtiene las credenciales guardadas de Forti/Omni durante el aprovisionamiento y las usa únicamente en el backend. Si cambian, vuelve a ejecutar `python "API Inventarios/scripts/configure_local.py"` después de actualizar Conexiones API y reinicia el servicio.

## Carga del catálogo y corte compatible

La API no reemplaza la base activa al arrancar. Primero revisa el catálogo importado actual y la copia de cambios pendientes:

```bash
python "API Inventarios/scripts/migrate_legacy_inventory.py"
```

La salida es un informe sin datos sensibles. Para importar catálogo, cambios físicos y auditoría conservando IDs, con respaldo privado automático:

```bash
python "API Inventarios/scripts/migrate_legacy_inventory.py" --apply
```

Antes del corte verifica el informe, configura credenciales de Forti/Omni y confirma que Scalar y CCTV responden. `--activate` activa el lector/escritor nuevo y deja una ruta compatible para consultas y ediciones actuales del dashboard. El corte inicial ya está activo en este entorno; el comando se incluye para despliegues nuevos:

```bash
python "API Inventarios/scripts/migrate_legacy_inventory.py" --apply --activate
```

La operación guarda una copia SQLite con permisos privados. Para volver al escritor anterior, detén Inventarios y ejecuta:

```bash
python "API Inventarios/scripts/migrate_legacy_inventory.py" --rollback --apply
```

Una sustitución documental posterior requiere preparar el nuevo JSON con el importador raíz, revisar el dry-run y utilizar `--replace` explícitamente. IDs huérfanos y conflictos detienen la transacción.

## Rutas principales

- `GET /api/v1/cctv/catalog`, `/cameras`, `/cameras/{id}`, `/summary`, `/export`.
- `GET /api/v1/cctv/integration/cameras` entrega a módulos externos, con una clave de
  `INVENTARIOS_INTEGRATION_KEYS`, únicamente identificador, nombre, IDF, ubicación,
  modelo y estado administrativo. No expone IP, MAC, serie, auditoría ni observaciones de red.
- `PATCH /api/v1/cctv/cameras/{id}` para campos físicos/administrativos mediante versión optimista.
- `/cameras/{id}/observations` y `/changes` para historial.
- `POST /api/v1/reconciliation/jobs`; consulta el resultado en `GET /api/v1/reconciliation/jobs/{id}`.
- `/api/v1/catalogs/networks` combina resumen documental y redes observadas, con procedencia.
- `/api/v1/sources` y `/sources/{sha256}/download`.
- `GET /health` es liveness público. La API no muestra inventario ni salud detallada de proveedores sin credencial.

`192.168.99.x` ayuda a localizar dispositivos, pero VLAN y máscara vienen de la configuración consultada en FortiGate. El octeto de la IP no se interpreta como VLAN. Una relación obtenida por interfaz observada se distingue de una inferida por subred. Estado de inventario, observación de red y salud de video son dimensiones distintas.

## Consumo por otro módulo

La API se mantiene en `127.0.0.1:8002` por defecto. Para permitir consumidores de la red,
publícala detrás de un proxy HTTPS interno y conserva la API en loopback. Crea una clave aleatoria
exclusiva en `INVENTARIOS_INTEGRATION_KEYS`; no reutilices la del dashboard. Un consumidor autorizado
puede solicitar, por ejemplo:

```text
GET https://api-sgrs.interno/api/v1/cctv/integration/cameras?idf_id=idf-1&limit=100
X-API-Key: <clave-del-modulo>
```

Restringe el proxy y firewall a las IP de los módulos consumidores. La configuración de DNS,
certificado y firewall se realiza en el servidor de producción y no se activa con este cambio de código.

La interfaz completa con VLAN se consulta usando `GET /api/v1/network/interface-config` en API Forti. Devuelve una lista limitada y tipada de interfaces en el VDOM solicitado. Omite propiedades crudas de configuración.

## Desarrollo y pruebas

```bash
cd "API Inventarios"
python -m pytest tests -q
```

La suite agregada raíz también ejecuta Inventarios en un proceso separado porque Forti, Omni e Inventarios usan cada uno un paquete Python `app` propio.

## Límites actuales

La asociación requiere identidad MAC/serie no ambigua; ARP permite encontrar cámaras con IP fija y no se toma como prueba de que estén en línea. DHCP puede no cubrir cámaras estáticas. La configuración VLAN de Forti no acredita el VLAN de un puerto de acceso si el tráfico no cruza esa interfaz. No hay todavía proveedor de video, grabación, switch de acceso o PoE.
