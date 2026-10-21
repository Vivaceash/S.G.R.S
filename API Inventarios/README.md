# SGRS — API Inventarios

Servicio FastAPI independiente para inventario CCTV, correcciones, cotejo de red e información VLAN de FortiGate. Incluye documentación Scalar en `/docs` y `/scalar`, OpenAPI configurable y base SQLite privada.

## Calidad documental CCTV

La importación actual conserva **153 registros CCTV**: 150 cámaras numeradas y 3 equipos sin número en `Actualización CCTV.xlsx`. Los tres se exponen como activos de primera clase, con `number` vacío, procedencia de hoja/fila y `issues` para completar la fuente:

- Fila 16: `Lobby Residencia-Transplante`, IP `192.168.99.156`; faltan número, serie, modelo y MAC.
- Fila 157: `Caseta`, IP `192.168.99.152`; faltan número de cámara.
- Fila 192: serie terminada en `FD7789329`, modelo `DS-2CD2723G2-LIZS2U`; faltan número, ubicación, IP y MAC.

El contrato `Camera.number` permite representar explícitamente el dato faltante. `GET /api/v1/cctv/catalog`, `/cameras` y `/export` incluyen esos registros; no se inventan números ni identidades.

## Inicio local

Desde la raíz, `python run.py` inicia OmniVista en `8000`, FortiGate en `8001`, Inventarios en `8002` y el dashboard. El primer inicio crea claves aleatorias en `API Inventarios/.private/.env` y una credencial privada para el proxy del dashboard. Cada servicio también se puede iniciar desde esta carpeta con `python run.py`. No se imprimen claves en consola.

Entra a `http://192.168.38.250:8002/scalar` para explorar los contratos desde la LAN; `/docs`, `/scalar`, `/` y `/swagger` conservan el mismo contrato Scalar. La clave de lectura, escritura y exportación se puede obtener localmente de `.private/.env` para herramientas autorizadas. Mantén ese archivo protegido y no lo compartas. Para producción, proporciona el conjunto completo `INVENTARIOS_*` desde el gestor de secretos y reemplaza las claves locales. El servidor escucha en todas las interfaces LAN mediante `INVENTARIOS_HOST=0.0.0.0`; `ALLOWED_HOSTS` y CORS limitan el acceso al host/origen institucional.

El dashboard administra la credencial de su conexión Inventarios en **Conexiones API**. La API obtiene las credenciales guardadas de Forti/Omni durante el aprovisionamiento y las usa únicamente en el backend. Cada inicio desde el runner raíz sincroniza las credenciales de los proveedores y la identidad local del dashboard, conservando conexiones remotas personalizadas. Los cambios de credenciales de proveedores se aplican al reiniciar la plataforma; la detección de redes nuevas no requiere cambiar configuración.

Las claves de lectura, escritura, exportación y dashboard no tienen longitud mínima. En producción debe existir al menos una clave, `DEBUG` debe estar desactivado y los hosts/orígenes deben ser explícitos. `.private/.env` tiene prioridad sobre el `.env` de esta carpeta; las variables del sistema tienen prioridad sobre ambos archivos. El aprovisionamiento conserva las claves y la configuración existentes al actualizar los proveedores.

## Actualización bajo demanda

La adquisición y lectura de redes y CCTV se ejecutan solo al usar los botones de actualización. El cotejo periódico está desactivado por defecto (`INVENTARIOS_REFRESH_SECONDS=0`). El botón de actualización del dashboard vuelve a consultar Forti/Omni; el botón del inventario consulta el catálogo CCTV. Una ficha en edición conserva los cambios pendientes.

Las redes operativas se consultan mediante `/api/networks` al actualizar el dashboard. Véase [el contrato de actualización](../docs/ACTUALIZACION_AUTOMATICA_RED.md).

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
- `GET /api/v1/cctv/reports` y `/reports/{idf_id}` consultan la bitácora IDF existente con filtros, ordenamiento y paginación; son de solo lectura y no devuelven rutas de evidencia ni identificadores internos de actores.
- `PATCH /api/v1/cctv/cameras/{id}` para campos físicos/administrativos mediante versión optimista.
- `/cameras/{id}/observations` y `/changes` para historial.
- `POST /api/v1/reconciliation/jobs`; consulta el resultado en `GET /api/v1/reconciliation/jobs/{id}`.
- `/api/v1/catalogs/networks` combina resumen documental y redes observadas, con procedencia.
- `/api/v1/sources` y `/sources/{sha256}/download`.
- `GET /health` es público; `GET /api/v1/system/health` requiere autenticación de lectura; `POST /api/v1/reconciliation/jobs` requiere permiso de escritura.
- Todas las consultas `/api/v1/cctv/*` requieren autenticación, incluidas catálogo, resumen, exportación e historiales. Usa una credencial de lectura configurada, enviada en `X-API-Key` o `Authorization: Bearer`. Las modificaciones requieren una credencial con permiso de escritura.

`192.168.99.x` ayuda a localizar dispositivos, pero VLAN y máscara vienen de la configuración consultada en FortiGate. El octeto de la IP no se interpreta como VLAN. Una relación obtenida por interfaz observada se distingue de una inferida por subred. Estado de inventario, observación de red y salud de video son dimensiones distintas.

La interfaz completa con VLAN se consulta usando `GET /api/v1/network/interface-config` en API Forti. Devuelve una lista limitada y tipada de interfaces en el VDOM solicitado. Omite propiedades crudas de configuración.

## Desarrollo y pruebas

```bash
cd "API Inventarios"
python -m pytest tests -q
```

La suite agregada raíz también ejecuta Inventarios en un proceso separado porque Forti, Omni e Inventarios usan cada uno un paquete Python `app` propio.

## Límites actuales

La asociación requiere identidad MAC/serie no ambigua; ARP permite encontrar cámaras con IP fija y no se toma como prueba de que estén en línea. DHCP puede no cubrir cámaras estáticas. La configuración VLAN de Forti no acredita el VLAN de un puerto de acceso si el tráfico no cruza esa interfaz. No hay todavía proveedor de video, grabación, switch de acceso o PoE.
