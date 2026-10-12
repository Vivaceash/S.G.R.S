# Plan de implementación de usuarios, privilegios y APIs

Fecha de revisión: 10 de septiembre de 2026. Estado: **propuesta para implementación futura**. Este documento no implica que la autenticación individual o RBAC ya estén implementados.

## Estado posterior a la implementación local

La ampliación solicitada incorpora creación/asignación de usuarios locales, sesiones y RBAC en el gateway, configuración de conexiones y formulario IDF móvil con reportes de escritorio. El alcance exacto, arranque y límites están en [USUARIOS_Y_CONEXIONES.md](USUARIOS_Y_CONEXIONES.md). Las secciones de análisis que siguen describen el estado observado antes de esta ampliación; no deben confundirse con el estado nuevo.

No se han completado las fases de OIDC/MFA, ámbitos, delegación a los microservicios, cifrado en reposo y auditoría integral. Esta implementación local no marca como terminado el roadmap de producción. Por indicación del usuario, no se ejecutaron pruebas funcionales ni conexiones a los equipos en esta ampliación.

Decisión vigente posterior: Superusuario es un rol interno y no seleccionable por cuentas operativas; las cuentas con permiso de consulta pueden ver las cuentas visibles, incluido el nivel superior. La asignación y edición siguen la jerarquía, la herencia y los permisos separados implementados. No se conceden permisos Linux. La revisión detallada y la distinción entre cambios implementados y páginas propuestas están en [ANALISIS_APIS_Y_EVOLUCION_DASHBOARD.md](ANALISIS_APIS_Y_EVOLUCION_DASHBOARD.md).

## 1. Alcance y decisiones propuestas

Tres roles fijos: `viewer`, `admin` y `super-admin`. Son perfiles para **cuentas personales**, no tres credenciales compartidas. Puede haber múltiples usuarios por rol. Si el requerimiento operativo es iniciar con exactamente tres cuentas, crear una cuenta nominal de cada rol durante el aprovisionamiento, con invitaciones individuales y sin contraseñas predefinidas.

La identidad SGRS es distinta de los empleados de OmniVista y de los perfiles de acceso WiFi. Un `access-role-profile` de OmniVista controla acceso a la red; no concede administración del dashboard. El rol SGRS tampoco debe cambiar automáticamente un perfil WiFi.

Propuesta: identidad mediante OIDC del proveedor institucional, sesión web en un BFF FastAPI y autorización central por permiso, recurso y ámbito. Las APIs Forti y Omni conservarán sus responsabilidades de integración. La protección se aplica tanto en el BFF como en cada API: ocultar botones no protege datos.

La identidad del proveedor (`issuer`, `subject`) será la referencia estable; el correo es un atributo mutable. No habilitar registro público. Provisionar por invitación o asignación institucional. MFA individual obligatorio para `admin` y `super-admin`; la obligatoriedad para `viewer` se confirmará con la política institucional antes de producción.

## 2. Análisis del repositorio

Se revisaron la estructura completa del código mantenido, los puntos de entrada, routers, esquemas, dependencias de autenticación, middleware, clientes upstream, persistencia, dashboard, lanzadores, pruebas y documentación. No se publican secretos ni contenidos personales de archivos de configuración/datos. No se realizó una prueba de penetración ni un escaneo activo sobre los equipos de red.

| Componente | Implementación comprobada | Consecuencia para la implementación |
| --- | --- | --- |
| `server.py` | Servidor HTTP multihilo, proxy a dos APIs, JSON en disco y endpoints de escritura. Inyecta una clave de servicio; no verifica identidad del navegador. | Es la frontera de mayor prioridad: puede eludir la protección de las APIs internas. Sustituirlo por BFF autenticado antes de exponer el sistema. |
| `API Forti/app/main.py`, `routers/` | FastAPI; 23 operaciones declaradas en routers: inventario, DHCP/ARP/interfaces, tráfico, firewall, VPN, salud y autenticación. Operaciones de negocio de lectura. | Separar lecturas operativas de información sensible: un GET de tráfico o VPN no es automáticamente apto para viewer. |
| `API Forti/app/core/security.py` | API keys y JWT HS256/TOTP implementados manualmente; verificación de firma, emisor, audiencia, expiración y 2FA. La dependencia devuelve texto, no un principal con permisos. | Reemplazar por verificación mantenida y un principal tipado. No extender la implementación criptográfica manual para el modelo nuevo. |
| `API Omni/app/main.py`, `routers/` | FastAPI; 19 operaciones declaradas: empleados, MACs autorizadas, monitoreo, catálogos, sistema y autenticación. | Empleados contienen datos personales; separar permiso y proyección de respuesta. No confundirlos con usuarios de SGRS. |
| `API Omni/app/dependencies.py` | Autenticación equivalente a Forti, pero devuelve booleano. Emisor/audiencia diferentes por servicio. | Unificar el contrato de identidad sin aceptar indiscriminadamente tokens de otra audiencia. |
| Ambos `routers/auth.py` | `/setup-2fa`, `/verify-2fa`, `/verify-token`; nombre de cuenta proporcionado por el solicitante con API key. | No existe una identidad individual verificable ligada a un usuario persistido. La rotación/revocación no puede basarse solo en el nombre declarado. |
| Ambos archivos de configuración | Defaults de desarrollo débiles; validadores bloquean diversas configuraciones inseguras fuera de development/test. | Conservar los validadores, extenderlos al BFF y eliminar defaults de claves en producción. No inferir que la configuración efectiva cumple a partir de los defaults. |
| Ambos `middleware/security.py` | Cabeceras, límites de tamaño, request IDs, proxies confiables y rate limiting en memoria. | Reutilizar los controles, con almacenamiento compartido de límites/sesiones y métricas de denegación. |
| `API Forti/app/clients/fortios.py` | Cliente HTTPX con pool, timeout, credencial de FortiOS, TLS configurable y operaciones de consulta. | La credencial del dispositivo permanece en servidor. No conceder operaciones de configuración por el mero hecho de ser super-admin. |
| `API Omni/app/services/omnivista_service.py` | Sesión requests compartida, reautenticación upstream, sanitización y consultas. | Revisar sincronización de renovación de token y límites de concurrencia; los POST internos usados para consultar no son altas de negocio. |
| Paginación Omni | `get_employee_accounts` consulta un subconjunto upstream y pagina localmente; el total se deriva de ese subconjunto. | Antes de usarlo como directorio completo, implementar paginación/cursor real y búsqueda upstream. Validar también Company Properties. |
| `app/schemas/`, errores y sanitizadores | Modelos de respuesta y sanitización de secretos. | Crear proyecciones explícitas por permiso; la sanitización por nombre de campo no reemplaza una allowlist de campos. |
| `data/` | `idfs.json`, `ips.json`, `devices.json`, `reports.json`; bloqueo de archivo dentro de un proceso. | No hay transacciones entre documentos, ETags, IDs estables de todos los objetos ni relaciones con usuarios. Migrar con respaldo y reconciliación. |
| Dashboard anterior | HTML/JS/CSS; cadenas HTML con datos externos, conteos de ejemplo, guardados sin esperar confirmación y acciones solo en memoria. | React escapa texto; el rediseño distingue demo/consulta y espera confirmación. La seguridad final requiere control en servidor. |
| `run.py` | Lanzador de servicios; puede terminar procesos por puerto mediante `free_ports_if_busy`. | Evitar usarlo para verificaciones sobre servicios activos. Migrar a procesos identificados y health checks, sin matar procesos ajenos. |
| Pruebas | Suites separadas por colisión del paquete `app`; Forti incluye consultas que aceptan 503 como respuesta controlada. | Un test verde con 503 no prueba conectividad con hardware. Añadir pruebas aisladas del BFF y matriz de autorización. |
| Documentación anterior | Referencias desactualizadas a React/Vite y a una identidad visual oscura que no correspondían al dashboard HTML existente. | Los documentos nuevos describen React/Tailwind y la identidad solicitada. El plan histórico de seguridad no acredita el nuevo BFF. |

### Hallazgos prioritarios

| Prioridad | Evidencia | Trabajo necesario |
| --- | --- | --- |
| P0 | `server.py:Handler.do_GET/do_POST`: no sesión en `/api/reports`, `/api/ips/update`, `/api/idfs/device` ni proxies. | Autenticar y autorizar **cada** entrada. No basta añadir roles a Forti y Omni. |
| P0 | Proxy genérico `/api/forti/*`, `/api/omni/*` e inyección de `APP_API_KEY`. | Allowlist explícita de método/ruta/permiso; rechazar rutas nuevas, traversal y métodos no registrados; retirar exposición de `/auth/*` upstream. |
| P0 | CORS `*`, bind de dashboard a todas las interfaces, ausencia de CSRF y límites equivalentes a las APIs. | BFF detrás de TLS, origen exacto, cookies seguras, CSRF, límites y despliegue en red controlada. |
| P1 | Secreto TOTP determinista o compartido; no hay usuarios, estado de enrolamiento, revocación individual ni protección de replay por usuario. | MFA en IdP o factores individuales cifrados, reautenticación, recuperación y revocación. |
| P1 | Sustitución completa de dispositivos por lista, actualización por índice y escritura JSON. | IDs UUID, esquema estricto, transacciones y control de versiones; autorización por IDF. |
| P1 | `/api/devices` puede devolver fallback local sin metadatos; `/api/health` prueba vida de servicios, no salud física. | Respuestas con `source`, `observed_at`, `fetched_at`, `stale`, `partial`; no declarar disponibilidad física con liveness. |
| P1 | Tráfico por IP, historial de navegación, sesiones VPN y empleados accesibles con la misma clave. | Permisos de datos sensibles, minimización, límites de exportación y trazabilidad de consultas. |
| P2 | Duplicación de seguridad entre servicios, rate limit local, documentación divergente y falta de CI mantenida. | Biblioteca interna probada, Redis si hay múltiples instancias, contratos OpenAPI y gates de CI. |

## 3. Matriz de privilegios propuesta

Todos los permisos están sujetos a sede/IDF/segmento/VDOM autorizado. `super-admin` no omite validación, MFA, auditoría ni invariantes de negocio. Se propone que `admin` no gestione cuentas: esa capacidad queda reservada a `super-admin` para evitar escalamiento por operaciones cotidianas.

| Capacidad / permiso | viewer | admin | super-admin |
| --- | --- | --- | --- |
| Resumen agregado `dashboard.read` | Sí | Sí | Sí |
| Inventario operativo `inventory.read` | Sí, campos mínimos | Sí | Sí |
| Crear/actualizar recurso `inventory.write` | No | En su ámbito | Sí |
| Retirar recurso `inventory.retire` | No | En su ámbito, con motivo | Sí, con motivo |
| Lectura IP `ipam.read` | Sí | Sí | Sí |
| Asignar/liberar IP `ipam.write` | No | En su ámbito, con confirmación de liberación | Sí |
| Consultar solicitudes `requests.read` | Resumen sin identidad del solicitante | En su ámbito | Sí |
| Crear/editar solicitudes `requests.write` | No | En su ámbito | Sí |
| Aprobar/rechazar `requests.review` | No | En su ámbito, sin autoaprobación | Sí, sin autoaprobación |
| Consulta de gabinete `idf.read` | Sí | Sí | Sí |
| Registrar visita/incidencia `idf.visits.write` | No | En su ámbito | Sí |
| Corregir visita `idf.visits.correct` | No | Nuevo evento, con motivo | Nuevo evento, con motivo |
| Bitácora operativa `activity.read` | Sin datos personales innecesarios | En su ámbito | Sí |
| Exportar inventario `inventory.export` | No por defecto | En su ámbito, con límites | Sí, con límites |
| Exportar datos personales/tráfico `sensitive.export` | No | No por defecto | Con MFA reciente y motivo |
| Empleados/MACs personales `directory.read` | No | En su ámbito | Sí |
| Configuración de firewall `firewall.read` | No | Lectura en su VDOM | Lectura |
| Tráfico individual `traffic.sensitive.read` | No | En su ámbito, con justificación | Sí, con justificación |
| Sesiones VPN `vpn.sensitive.read` | No | En su ámbito | Sí |
| Diagnóstico profundo `integrations.diagnose` | No | Lectura en su ámbito | Sí |
| Usuarios `users.read/create/edit/delete` | Según delegación | Según delegación y jerarquía | Sí, con las protecciones del servidor |
| Credenciales de integración `integrations.manage` | No | No | Rotar/configurar; secretos no revelados por defecto |
| Auditoría de seguridad `audit.read` | No | No por defecto | Sí |
| Editar/borrar auditoría | No | No | No |
| Cambiar configuración en FortiOS/OmniVista | No | No | Fuera del alcance actual; requiere capacidad explícita futura |

Las dos decisiones a ratificar antes de implementar son: qué sedes/VDOM/IDFs corresponde operar a cada cuenta y si `admin` tendrá acceso habitual a tráfico personal o requerirá concesión temporal. Hasta definirlas, esas capacidades quedan denegadas. La matriz es una propuesta revisable, no una política activada por el frontend.

## 4. Inventario de rutas y asignación futura

### BFF actual y reemplazos

| Ruta actual | Permiso / tratamiento propuesto |
| --- | --- |
| `GET /api/idfs` | `idf.read`; filtrar objetos y campos por ámbito |
| `GET /api/ips` | `ipam.read`; ocultar MAC/responsable cuando no corresponda |
| `GET /api/devices`, `/api/devices/summary` | `inventory.read` / `dashboard.read`; endpoints exactos, sin coincidencia genérica de prefijo |
| `GET /api/reports` | `activity.read`; filtrar antes de devolver datos |
| `POST /api/reports` | `idf.visits.write`; actor/fecha generados en servidor |
| `POST /api/ips/update` | `ipam.write`; separar asignación y liberación |
| `POST /api/idfs/device` | `inventory.write`; UUID y versión, retirar reemplazo masivo por lista |
| `GET /api/traffic/ip/{ip}` | `traffic.sensitive.read`; verificar que la IP pertenece al ámbito |
| `GET /api/health` | Resumen autenticado `dashboard.read`; publicar un `/health/live` mínimo separado |
| `GET /api/ip` | Retirar descubrimiento de IP de la interfaz; configurar un origen público HTTPS para QR |
| `GET/POST /api/forti/*`, `/api/omni/*` | Sustituir por rutas explícitas; autenticación upstream no accesible desde proxy genérico |

### Forti — prefijo `/api/v1`

| Método y rutas declaradas | Permiso mínimo |
| --- | --- |
| `GET /devices`, `/devices/{mac_or_ip}` | `inventory.read`, con proyección de campos y ámbito |
| `GET /network/dhcp-pools`, `/network/dhcp-leases`, `/network/arp-table`, `/network/interfaces` | `network.read`; leases/ARP minimizados para viewer |
| `GET /system/status`, `/system/resources` | `dashboard.read` para proyección agregada; detalle con `integrations.diagnose` |
| `GET /system/firmware`, `/health` | `integrations.diagnose` |
| `GET /firewall/policies`, `/firewall/addresses`, `/firewall/address-groups` | `firewall.read` |
| `GET /traffic/sessions`, `/traffic/destinations`, `/traffic/logs`, `/traffic/ip/{ip}` | `traffic.sensitive.read` |
| `GET /vpn/ipsec` | `network.read`, proyectar estado sin configuración sensible |
| `GET /vpn/ssl-sessions` | `vpn.sensitive.read` |
| `GET /auth/status` | Retirar del contrato público del dashboard durante migración |
| `POST /auth/setup-2fa`, `/auth/verify-2fa`, `/auth/verify-token` | Reemplazar por identidad central; no mantener un bypass de API key para usuarios |

### Omni — prefijo `/api/v1`

| Método y rutas declaradas | Permiso mínimo |
| --- | --- |
| `GET /catalogs/access-role-profiles`, `/catalogs/device-options`, `/catalogs/vlans` | `network.read`, solo catálogo autorizado |
| `GET /company-properties`, `/company-properties/{device_mac}` | `directory.read` |
| `GET /employees`, `/employees/{username}` | `directory.read` |
| `GET /monitoring/infrastructure-stats` | `dashboard.read` con agregados |
| `GET /monitoring/devices`, `/monitoring/devices/{ip_address}`, `/monitoring/topology` | `inventory.read` / `network.read`, alcance por objeto |
| `GET /monitoring/online-devices` | `directory.read` para sesiones identificables; crear agregado para viewer |
| `GET /monitoring/notifications` | `activity.read` con minimización |
| `GET /system/health`, `/system/version` | `integrations.diagnose` |
| `GET /auth/status`, `POST /auth/setup-2fa`, `/auth/verify-2fa`, `/auth/verify-token` | Retirar en favor de identidad central |

`network.read` pertenece a los tres roles únicamente para proyecciones operativas y ámbitos permitidos. No devolver la respuesta completa de un GET privilegiado y esperar que React oculte campos. `/health` público de cada servicio, OpenAPI, Scalar y sus alias también deben inventariarse: liveness mínimo público; documentación deshabilitada o protegida en producción.

## 5. Arquitectura de identidad y autorización

Flujo: navegador → proxy TLS → BFF FastAPI → API Forti / API Omni → dispositivos. El BFF consulta PostgreSQL para usuarios/permisos y Redis para sesiones/revocación. OIDC autentica a las personas. Las credenciales de FortiOS/OmniVista se guardan exclusivamente en un gestor de secretos del servidor.

1. Login OIDC Authorization Code con PKCE; comprobar `state`, `nonce`, emisor, audiencia, firma y redirect URI exacta. Tokens upstream fuera de JavaScript.
2. BFF crea sesión opaca aleatoria, rota el ID al autenticar y emite cookie `__Host-sgrs_session; HttpOnly; Secure; SameSite=Lax; Path=/`, sin `Domain`. Definir duración absoluta/inactividad; propuesta inicial de 8 horas/30 minutos y reautenticación menor a 5 minutos para acciones sensibles.
3. En cada solicitud: sesión válida → usuario activo → permisos vigentes → recurso dentro del ámbito → campos/transición permitidos → ejecución. Denegar por defecto. Rol desconocido, ámbito faltante o fallo del almacén no conceden acceso.
4. Usar token CSRF ligado a sesión y verificación de origen en mutaciones. SameSite complementa, no sustituye CSRF. CORS solo para el origen institucional, sin comodines con credenciales.
5. El BFF obtiene/emite credencial delegada de vida corta específica para cada servicio. El servicio valida firma, `iss`, `aud`, `exp`, `nbf`, `sub`, tipo de principal, permisos y ámbitos. Preferir mecanismo soportado por el IdP; alternativa: emisor interno con claves asimétricas y rotación JWKS. No confiar en `X-User`, `X-Role`, `user_id` o ámbitos enviados por el navegador.
6. Conservar la identidad del usuario en auditoría de extremo a extremo mediante principal verificado y `request_id`. Las tareas automáticas usan principales de servicio diferentes, con scopes mínimos; una API key legacy nunca confiere todos los privilegios de usuario.
7. Desactivación, cambio de rol o ámbito incrementa `authz_version` e invalida sesiones. La revocación debe comprobarse en BFF y en APIs durante la ventana de tokens delegados; usar introspección/estado compartido o fijar explícitamente una ventana máxima verificable. No prometer revocación inmediata con un JWT desconectado del estado.
8. Cierre de sesión revoca servidor y cookie, limpia datos en memoria y notifica otras pestañas. Manejar 401 como sesión vencida, 403 como falta de permiso, 409 como conflicto y 429 con `Retry-After`.

Fundamentos consultados: [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) para denegación por defecto/verificación por solicitud; [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) para sesión/cookies; [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) para mutaciones; [RFC 9700](https://www.rfc-editor.org/info/rfc9700/) para seguridad OAuth. La matriz institucional de este documento es una propuesta propia, no una política dictada por esas fuentes.

## 6. Modelo de datos propuesto

| Entidad | Campos / invariantes |
| --- | --- |
| `users` | UUID, `oidc_issuer`, `oidc_subject`, nombre, correo, estado invited/active/suspended, role_id, authz_version, created_at; unique(issuer, subject) |
| `roles` | Solo viewer/admin/super-admin; nombres únicos, no creación arbitraria desde UI |
| `permissions`, `role_permissions` | Catálogo versionado, asignaciones explícitas; sin comparaciones numéricas de nivel |
| `scopes`, `user_scopes` | Sede, IDF, VLAN/segmento, VDOM e integración; FK a recursos existentes |
| `sessions` | Hash de ID de sesión, user_id, expiración absoluta/inactividad, revocación, versión y nivel MFA; sin tokens en logs |
| `service_principals` | Identidad de servicio, audiencias y scopes mínimos, estado y rotación; separada de users |
| `idfs`, `inventory_items` | UUID estable, ubicación, equipo, estado y version; no actualización por índice |
| `ip_allocations` | Dirección validada, segmento, estado, equipo, version; unicidad por segmento/VRF; transiciones validadas |
| `network_requests` | Folio único, solicitante, área, dispositivo, red solicitada, estado, creador y revisor, version |
| `idf_visits`, `incidents` | IDF, actor_user_id, fecha del servidor, temperatura, motivo, estado; correcciones como eventos nuevos |
| `attachments` | Visita, object_key aleatoria, tipo/tamaño/digest, autor y estado de análisis; acceso mediante autorización o URL temporal |
| `audit_events` | Actor verificado, acción, recurso, ámbito, resultado, timestamp UTC, request_id, motivo, cambios mínimos; append-only |
| `idempotency_keys`, `outbox` | Actor/operación/clave únicos, digest del payload, resultado y expiración; auditoría/eventos externos coordinados con transacción |

Se propone PostgreSQL con migraciones Alembic. SQLite solo para desarrollo/pruebas. No guardar contraseñas locales si se adopta OIDC. Si la organización exige autenticación local, tratarlo como variante explícita: Argon2id, recuperación de un solo uso, MFA individual, bloqueo/limitación y revisiones adicionales.

## 7. Contratos nuevos y reglas de negocio

Rutas propuestas bajo `/api/v2` para evitar cambiar silenciosamente consumidores actuales:

- Identidad: `GET /auth/login`, callback OIDC, `POST /auth/logout`, `GET /me`, `GET /me/capabilities`, `GET /me/sessions`, `DELETE /me/sessions/{id}`.
- Administración: `GET/POST /users`, `GET/PATCH /users/{id}`, `POST /users/{id}/suspend`, `POST /users/{id}/reactivate`, `PUT /users/{id}/role`, `PUT /users/{id}/scopes`, `POST /users/{id}/revoke-sessions`.
- Inventario: `GET/POST /inventory/items`, `GET/PATCH /inventory/items/{id}`, `POST /inventory/items/{id}/retire`; no borrado físico rutinario.
- IPAM: `GET /ip-allocations`, `POST /ip-allocations/{id}/assign`, `POST /ip-allocations/{id}/release`.
- Altas: `GET/POST /network-requests`, `GET/PATCH /network-requests/{id}`, `POST /network-requests/{id}/submit`, `/approve`, `/reject`, `/cancel`.
- Visitas: `GET/POST /idfs/{id}/visits`, `GET /visits/{id}`, `POST /visits/{id}/corrections`, `POST /visits/{id}/attachments`.
- Auditoría: `GET /audit/events`, `POST /audit/exports`; sin PATCH/DELETE de eventos.

Respuesta normalizada: `data`, `meta` (`total`, `page`/cursor, `page_size`, `source`, `observed_at`, `fetched_at`, `stale`, `partial`), `request_id`. Error: `code`, `message`, `field_errors`, `request_id`; sin trazas internas. `If-Match`/version obligatorio en actualizaciones y `Idempotency-Key` en altas, aprobación, liberación y movimientos.

Transiciones propuestas de solicitud: borrador → pendiente → en revisión → aprobada/rechazada; cancelación solo en estados definidos. Aprobación requiere revisor distinto del creador, ámbito compatible y motivo. Aprobar **no significa** que el dispositivo ya esté configurado: cualquier aprovisionamiento posterior será un trabajo separado con estado pendiente/aplicado/fallido y una integración de escritura aún no existente.

No permitir autoasignación de rol, inyección de campos privilegiados ni suspensión/degradación del último super-admin activo. Comprobar esa invariante dentro de una transacción bloqueada para impedir carreras. Crear el primer super-admin mediante un comando administrativo de un solo uso o bootstrap institucional, cerrar el bootstrap y auditarlo.

La liberación IP solo modifica IPAM hasta que exista un contrato de sincronización con DHCP. No inferir propiedad a partir de que el usuario conozca una IP, MAC o URL QR. Los QR identifican un gabinete, no autorizan a entrar al sistema.

Fotografías: máximo propuesto 10 MB por archivo, PNG/JPEG, validación real de contenido en servidor, análisis, eliminación de metadatos innecesarios y almacenamiento fuera del directorio público. Definir retención y autorización antes de habilitar uploads. No codificar archivos en JSON de reportes ni localStorage.

## 8. Roadmap con entregables y aceptación

Estimación orientativa para un equipo con acceso al IdP y a staging: 6–8 semanas, a recalibrar tras definir ámbitos e integración institucional. El orden importa más que las fechas.

| Fase | Entregable | Dependencia | Criterio de aceptación |
| --- | --- | --- | --- |
| 0 · 2–3 días | Ratificar matriz, ámbitos, datos sensibles, IdP y retención; inventariar consumidores y configuración efectiva | Responsable de redes/seguridad | ADR y matriz versionados; rutas públicas explícitas; ninguna decisión sensible implícita |
| 1 · 4–6 días | BFF FastAPI, validación de payloads, TLS/origen/CSRF, proxy allowlist, metadatos de procedencia | Fase 0 | Ninguna ruta de datos accesible sin sesión; proxy genérico cerrado; errores/cuerpos limitados |
| 2 · 5–7 días | PostgreSQL, migraciones, usuarios nominales, OIDC, MFA, sesiones y revocación | IdP, Fase 1 | Login/logout/suspensión, expiración y recuperación probados; bootstrap cerrado |
| 3 · 5–7 días | Principal compartido y autorización por permiso/objeto en ambos servicios | Fase 2 | Matriz negativa completa; sin bypass por llamadas directas, API key legacy, VDOM, MAC, IDF o parámetros |
| 4 · 5–7 días | Transacciones, UUID/versiones, idempotencia, auditoría, migración JSON y contratos v2 | Fases 2–3 | Sin pérdida/duplicados; cambios concurrentes producen 409; ningún actor proviene del formulario |
| 5 · 4–6 días | React consume `/me/capabilities`; formularios/403/sesión; gestión de usuarios super-admin | Contratos v2 | Mismos permisos en vista/ruta/API; drafts en memoria preservados; cambios de rol efectivos |
| 6 · 4–6 días | Altas WiFi persistidas, revisión, stock/movimientos y evidencia fotográfica | Flujos y retención aprobados | Flujo completo y efectos externos explícitos; prueba de doble envío y archivos adversos |
| 7 · 3–5 días | Staging, migración ensayada, CI, observabilidad y manual de operación | Todas | Gates de liberación, restore probado y ninguna dependencia de accesos anónimos |

### Distribución de archivos futura

- `backend/app/auth/`: OIDC, sesiones, CSRF y principal.
- `backend/app/authorization/`: permisos y scopes, autorización por objeto.
- `backend/app/models/`, `migrations/`, `repositories/`: persistencia y transacciones.
- `backend/app/routers/`: rutas BFF explícitas, usuarios e inventario.
- `packages/sgrs_security/`: verificación compartida de tokens delegados; publicar/instalar una versión fija en cada API.
- `API Forti/app/core/security.py` y `API Omni/app/dependencies.py`: adaptadores al principal común.
- `Dashboard/src/auth/`: estado de sesión y capacidades; no descifrar JWT como fuente de autorización.
- `tests/authorization/`, pruebas BFF, pruebas de contratos y E2E con usuarios por rol.

## 9. Estrategia de migración y rollback

1. Respaldar JSON/configuración de manera cifrada; capturar conteos y hashes sin exponer contenido. Ensayar importación en staging, detectar IPs/folios duplicados, fechas ambiguas y equipos sin identificador.
2. Asignar UUID, preservar IDs históricos como referencia, conservar el responsable antiguo como `legacy_actor_label` sin convertirlo en usuario autenticado. Fechas sin zona deben conservarse como legado hasta reconciliación; no reinterpretarlas silenciosamente.
3. Migración inicialmente de solo lectura; reconciliar conteos, relaciones y muestreo. Congelar escrituras brevemente para importación final. Evitar dual-write no transaccional a JSON y SQL.
4. Desplegar BFF/servicios con permisos y un grupo piloto; separar versión de esquema y rollout de frontend. Importar roles/ámbitos antes de habilitar cuentas.
5. Retirar rutas legacy e inyección de clave compartida después de migrar consumidores. Bloquear acceso directo a puertos internos, mantener enforcement en las APIs.
6. Rollback de interfaz posible al build anterior compatible; rollback de backend solo a una versión que conserve autenticación y autorización. **Nunca** reabrir el proxy anónimo para resolver una incidencia. Si no hay versión segura, modo mantenimiento de solo lectura autorizado.
7. Restore ensayado con RPO/RTO definidos por operaciones; no ejecutar migraciones destructivas sin recuperación verificada.

## 10. Pruebas obligatorias antes de producción

- Por cada ruta: anónimo, viewer/admin/super-admin, otro ámbito, usuario suspendido, rol desconocido, sesión revocada y API principal de servicio. Verificar código, ausencia de datos y ausencia de efectos.
- Identidad: token expirado, firma inválida, algoritmo incorrecto, audiencia/emisor equivocado, falta de MFA, reuso de callback y replay; no aceptar Bearer destinado a otro servicio.
- Objetos: cambiar IDF, ID, MAC, IP, VLAN o VDOM; listados/contadores/exportaciones no revelan objetos fuera del ámbito. Probar también búsqueda y detalles individuales.
- Administración: admin no crea usuarios; autoelevación denegada; último super-admin protegido incluso con dos solicitudes simultáneas; revocación comprobada en las tres capas.
- Mutaciones: doble clic/reintento timeout, idempotencia con payload cambiado, cambio de versión, CSRF y mass assignment. No permitir transiciones de solicitud fuera de orden.
- Auditoría: actor/resultado confiables, escritura coordinada con operación, eventos de denegación y exportación; no guardar contraseñas/tokens/datos excesivos; ningún rol edita/borrar eventos.
- Frontend: rutas 401/403/404 distintas, formularios preservados ante error, paginación/restauración, móvil/teclado/foco, XSS en celdas y neutralización CSV.
- Infraestructura: TLS, origen exacto, CSP compatible con build, secretos independientes, tamaños/rate limit, restauración, alertas y trazabilidad de proveedor caído.
- CI: tests offline deterministas; integración con hardware como suite separada explícita. Dependency audit, secret scanning, SAST y build React reproducible por lockfile.

## 11. Dashboard entregado en esta etapa

React + Tailwind, navegación y componentes compartidos; diseño basado en las cinco referencias de `Downloads/diseno`. Usa los endpoints actuales para inventario, direcciones, dispositivos, DHCP y visitas. La demostración se activa explícitamente con `?demo=1`; no consume ni escribe las APIs.

No se implementan en esta etapa cuentas reales, concesión de roles, cambios de configuración en equipos, altas WiFi persistidas, stock por unidades persistido, carga de fotografías ni auditoría inmutable. Sus pantallas distinguen capacidades disponibles, demostración y pendientes. Ninguna afirmación visual de permisos debe interpretarse como seguridad implementada.
