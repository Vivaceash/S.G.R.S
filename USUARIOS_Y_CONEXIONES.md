# Usuarios locales, conexiones API y registro IDF

## Alcance implementado

Esta etapa añade cuentas locales al gateway del dashboard, sin depender de un proveedor de identidad externo. La autorización se comprueba en el servidor, no solo en los botones. Es una implementación para una instancia local; no sustituye las fases de SSO/MFA, ámbitos por sede/IDF/VDOM y protección del acceso directo a los microservicios del plan general.

| Operación | viewer | admin | super-admin |
| --- | --- | --- | --- |
| Dashboard, inventario y reportes | Consulta con minimización de campos | Consulta | Consulta |
| Agregar/actualizar recursos y asignar/liberar IP | No | Sí | Sí |
| Registrar visita/incidencia y adjuntar evidencia | No | Sí | Sí |
| Exportación desde la interfaz | No | Sí | Sí |
| Crear usuarios y administrar cuentas visibles | No | Sí, roles admin/soporte | Sí, todos los roles |
| Ocultar o volver visible una cuenta | No | No | Sí |
| Configurar/probar conexiones y credenciales | No | No | Sí |
| Consultas sensibles mediante proxy (tráfico, etc.) | No | No | Solo lectura |
| Configurar equipos mediante API externa | No | No | No |

El ámbito actual es esta instancia completa: todavía no se asignan subconjuntos de sedes a las cuentas. Los perfiles admin no acceden a los proxies de datos sensibles mientras se define esa política. Ocultar Exportar no es DRM: cualquier dato legible puede copiarse manualmente.

## Jerarquía visible e interna

Administrador es el nivel operativo superior visible para ejecutivos. Superusuario es un rol interno permanente de SGRS, sin relación con sudo/Linux. Conserva el identificador `super-admin` en SQLite para no migrar cuentas existentes.

El servidor entrega un catálogo `roles` en login/sesión: viewer y admin reciben únicamente Viewer y Administrador; solo Superusuario recibe el tercer rol. En la lista de Usuarios, las cuentas super-admin visibles se presentan como Administrador, sin mostrar privilegios ni páginas internas. El super-admin puede ocultar una cuenta: deja de aparecer a las cuentas operativas, que tampoco pueden administrarla usando su ID. Ocultarla conserva el inicio de sesión; suspenderla es una acción aparte. El filtro Visibles/Ocultos/Todas solo se ofrece a super-admin.

Las tarjetas de Usuarios solo muestran los roles operativos; ambos tipos de administrador cuentan como Administrador. Ocultar información visual no convierte el rol en secreto ante acceso al repositorio, servidor o bundle frontend. Este manual y el informe de arquitectura son documentación técnica, no ayuda pública para ejecutivos.

La contraseña de inicio de sesión aparece en la petición que envía el navegador de la propia persona; eso es visible en sus DevTools y no se puede ocultar al cliente. En HTTP podría observarse en el trayecto, por eso el acceso desde otros equipos requiere HTTPS. El servidor no devuelve la contraseña ni su hash, conserva un hash scrypt y emite la sesión en cookie `HttpOnly`.

Las consultas del proxy se restringen ahora a una lista explícita de rutas de lectura y patrones de detalle conocidos; las nuevas rutas del proveedor no se habilitan automáticamente. Se conservan denegadas autenticación, documentación y escrituras externas. Véase [análisis completo de cobertura y evolución](ANALISIS_APIS_Y_EVOLUCION_DASHBOARD.md).

## Primer inicio

Desde la raíz del proyecto, utilizando el entorno Python existente:

```bash
.venv/bin/python dashboard_access.py bootstrap
npm --prefix Dashboard run build
.venv/bin/python server.py
```

El comando solicita usuario, nombre y contraseña (12–128 caracteres, entrada oculta). Crea el primer `super-admin` únicamente si no existe ninguna cuenta; no imprime ni genera contraseñas predeterminadas. No hay un endpoint público de registro ni bootstrap por navegador.

Abrir `http://127.0.0.1:3000` e iniciar sesión. En desarrollo, Vite puede seguir sirviendo el frontend en el puerto 5173 y reenviando `/api` a Python. Reinicia únicamente el proceso habitual de Python para cargar el nuevo código; no es necesario iniciar las APIs externas para administrar cuentas.

En **Administración → Usuarios y privilegios**, al pie del sidebar, admin puede crear cuentas de soporte o administrador; super-admin puede asignar todos los roles y configurar páginas. Para cambiar contraseña o estado, abrir Administrar, revisar la consecuencia y confirmar. Super-admin también puede ocultar y restaurar cuentas. No hay eliminación definitiva. La suspensión se revierte seleccionando Activa.

Se permite cambiar el propio rol dentro de la jerarquía autorizada, con confirmación explícita y cierre de sesión inmediato. No se permite suspender la propia cuenta ni degradar/suspender el último super-admin activo, incluso con peticiones concurrentes. Cambiar rol, contraseña o usuario de acceso y suspender una cuenta revoca sus sesiones. La entrega de contraseñas es manual por un canal seguro; invitaciones y cambio obligatorio en primer ingreso quedan para una fase posterior.

## Conexiones con las APIs

Solo super-admin accede a **Administración → Conexiones API**, también al pie del sidebar. Hay una configuración independiente para FortiGate y otra para OmniVista:

- URL base de la API intermedia, incluyendo `/api/v1`.
- Tipo de autenticación: `X-API-Key`, Bearer o Basic (este último muestra un campo de usuario).
- Contraseña/clave de consulta, oculta por defecto, con control de mostrar/ocultar.
- **Probar conexión**: usa los valores del formulario sin guardarlos; realiza un GET autenticado a `/health` en Forti o `/system/health` en Omni. Devuelve resultado, estado HTTP y tiempo observado, no el cuerpo remoto.
- **Guardar conexión**: confirma el destino y persiste su configuración. Las siguientes consultas usan estos valores sin reiniciar Python.

Las APIs actuales del proyecto esperan `X-API-Key` o Bearer. Basic solo sirve si la API intermedia o su proxy lo admite. Estos campos no cambian la contraseña del firewall/NMS: sus credenciales siguen siendo responsabilidad de cada microservicio.

La credencial almacenada nunca se devuelve en GET; solo se informa `has_secret`. Un campo vacío conserva la credencial únicamente si URL, autenticación y usuario no cambiaron. Al cambiar el destino se exige introducirla otra vez para evitar reenviar una clave anterior a un servidor diferente. Las versiones impiden sobrescribir cambios de otro administrador.

HTTP se acepta solo para loopback (`localhost`/`127.0.0.1`); para otros destinos se exige HTTPS con certificado válido. No hay interruptor para omitir TLS. No se siguen redirecciones; se valida y fija la dirección DNS de cada solicitud y se bloquean destinos link-local/metadatos, multicast y no especificados. Se permiten direcciones privadas de infraestructura deliberadamente; solo un super-admin debe seleccionar esos destinos.

Las configuraciones guardadas prevalecen sobre `FORTI_API_URL`/`OMNI_API_URL`. Antes del primer guardado se usan esas variables y `FORTI_API_KEY`/`OMNI_API_KEY`, con fallback a `APP_API_KEY` si está definida. Ya no se inserta la clave `admin` por defecto desde el gateway.

## Registro IDF: vista general y acceso individual

La entrada del menú conserva «Registro IDF». En los permisos modulares se asignan por separado «Bitácora IDF general» (`bitacora-idf`) y «Registro IDF» (`idf`). El permiso de «Bitácora» corresponde al historial general de movimientos y no es requisito para consultar la bitácora de un gabinete.

- «Bitácora IDF general» habilita la página sin gabinete seleccionado, con tarjetas IDF arriba, filtros y tabla a 16 px, sin KPI. Permite consultar detalles; no permite abrir inventarios, emitir QR ni resolver incidencias. Con este permiso solamente, las tarjetas IDF son informativas.
- «Registro IDF» permite seleccionar gabinetes y consultar su bitácora e inventario. El registro de incidencias, su resolución y el QR siguen sujetos a las capacidades del rol. Si no se asigna la vista general, se abre un gabinete y no se ofrece volver a la tabla consolidada.
- La API comprueba permisos y capacidades. `/api/idfs?view=general` entrega nombres, cantidades y entradas de bitácora, sin inventario ni credenciales QR; `/api/reports?view=general` requiere el permiso de vista general. Las consultas sin `view=general` requieren acceso individual. Evidencias, escrituras y rutas de inventario tienen controles adicionales.
- La migración `idf-overview-page-v1` conserva una sola vez el acceso de cuentas que antes tenían simultáneamente `idf` y `bitacora`. Las revocaciones posteriores del nuevo permiso se respetan. Los valores predeterminados de admin, super-admin y viewer incluyen ambos permisos; soporte conserva sus permisos actuales. El código anterior ignora el permiso adicional y la tabla de migraciones, por lo que volver a la versión anterior no requiere borrar datos.
- Los enlaces `#reporte?idf=...` y `#entrada?idf=...` conservan el formulario de incidencia y requieren acceso individual. Cambiar el ancho de pantalla no concede permisos. La fecha y la identidad definitivas se asignan en el servidor; en demo puede escribirse el responsable. Los reportes se actualizan mediante consultas periódicas.

Se admite una fotografía PNG/JPG de hasta 10 MB por registro, validando tipo, firma y tamaño en el servidor. Se guarda fuera del directorio público y solo admin/super-admin pueden descargarla desde el detalle. Se entrega como archivo adjunto, nunca como HTML ni SVG ejecutable. No se procesa ni reencodea la imagen: antivirus, eliminación de EXIF y procesamiento seguro deben añadirse antes de abrir cargas a un entorno no confiable.

Los reportes nuevos usan identificador de solicitud estable, responsable autenticado y escritura JSON atómica. Repetir un identificador existente de la misma cuenta devuelve el registro ya guardado; otro usuario no puede apropiárselo. Los reportes históricos se conservan. Los cambios de inventario mantienen los contratos JSON anteriores y no tienen todavía control de versión transaccional.

## Almacenamiento y límites de seguridad

- `dashboard_access.py`: SQLite en `.sgrs-private/dashboard.sqlite3`, directorio `0700` y archivo `0600`, excluido del build público. Actualmente Git incluye la base privada y los `.env`: los permisos locales no protegen las copias del repositorio ni su historial.
- Contraseñas de usuario: scrypt con sal aleatoria por cuenta (`N=32768`, `r=8`, `p=1`). Nunca se almacenan en texto plano ni se devuelven a la interfaz.
- Credenciales API: recuperables en SQLite para enviar las consultas. **El archivo tiene permisos restrictivos, pero los secretos no están cifrados en reposo.** Utilizar cifrado de disco y restringir las copias de seguridad en local; migrar a un almacén de secretos antes de producción. No guardar credenciales reales en modo demo.
- Sesiones: token aleatorio con hash en DB, duración máxima de 8 horas e inactividad máxima de 30 minutos; cookie HttpOnly/SameSite=Strict/Secure mediante el proxy HTTPS local autorizado. CSRF en escrituras y validación de origen/Host; sin CORS comodín. HTTP remoto no permite autenticación ni consultas con sesión.
- Auditoría local: creación/cambio de cuentas, cambio de conexiones, intento de diagnóstico y acceso satisfactorio. No contiene contraseñas ni tokens. No es un registro inmutable ni una auditoría completa de todas las operaciones.
- Límites de intentos de acceso por usuario/IP y global; hasta seis diagnósticos por minuto por super-admin. Catálogo local limitado a 1000 cuentas.
- Ejecutar una sola instancia del gateway: el inventario y los reportes siguen dependiendo de archivos y un lock de proceso. Las cuentas y las conexiones sí usan transacciones SQLite.

No exponer directamente los puertos de Forti/Omni a clientes finales: esos servicios conservan su autenticación de integración y aún no reciben la identidad individual del dashboard. Para despliegue institucional quedan pendientes MFA/SSO, ámbitos, delegación de identidad, almacenamiento cifrado, auditoría completa y revisión de seguridad.

## Acceso desde un teléfono

`localhost` en el teléfono no es la computadora. El gateway escucha en `127.0.0.1` por defecto. Para uso real desde móvil, publicar mediante un reverse proxy HTTPS de la red autorizada, conservar el Host original y configurar, por ejemplo:

```bash
SGRS_PUBLIC_ORIGIN=https://sgrs.institucion.gob.mx .venv/bin/python server.py
```

El ejemplo es ilustrativo: requiere DNS y TLS válidos, no se crea ningún dominio automáticamente. Mantener el gateway detrás del proxy; no desactivar estas protecciones para enviar contraseñas por HTTP a la red. La apariencia móvil puede revisarse localmente reduciendo el ancho sin configurar infraestructura adicional.

El proxy debe ejecutarse en el mismo equipo, conservar Host y establecer `X-Forwarded-Proto` a partir de la conexión real. Ver [configuración HTTPS](Dashboard/README.md#https-para-acceso-desde-otros-equipos) y [Caddyfile de ejemplo](deploy/Caddyfile.example). El flujo QR `/api/mobile-report` aún admite HTTP para compatibilidad; usar HTTPS también para esos enlaces protege sus tokens y datos.

## Modo demostración y verificación

`http://127.0.0.1:5173/?demo=1` permite explorar la operación sin Python ni APIs como administrador operativo. Usuarios y Conexiones no aparecen en esta demo; abrir sus rutas directamente presenta una denegación genérica. Para administrar cuentas y conexiones se requiere iniciar sesión con la cuenta interna provisionada desde terminal. Las cuentas de ejemplo no inician sesión real.

Por indicación del usuario, esta etapa no ejecuta pruebas de navegador, pruebas de APIs ni conexiones a los equipos. Se comprueban compilación y sintaxis; la validación funcional/seguridad debe hacerse antes de usar cuentas y credenciales reales. Las capturas y el reporte de navegador de la primera entrega en `Dashboard/artifacts` son evidencia histórica, no validación de estas funciones nuevas.

Quedan preparados, sin ejecutar en esta etapa, `tests/test_dashboard_access.py` (almacenamiento temporal y ninguna conexión de red) y `Dashboard/tests/browser.mjs` (todas las APIs interceptadas). No se requiere acceso a FortiGate/OmniVista para ejecutarlos más adelante; la integración con equipos reales debe verificarse por separado.
