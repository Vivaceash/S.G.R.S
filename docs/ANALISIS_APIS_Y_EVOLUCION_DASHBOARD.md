# APIs y evolución del dashboard SGRS

## Actualización de implementación · 11 de septiembre de 2026

Esta actualización reemplaza las afirmaciones de “no implementado/no probado” del análisis original que sigue abajo. Se incorporaron nueve secciones de consulta en React, con 30 vistas de datos (incluye el histórico local), búsqueda y paginación sobre el bloque recibido, exportación y detalle de campos. El catálogo se entrega desde el servidor solo a la cuenta técnica autorizada; no se comunica a admin/viewer.

Se verificaron consultas reales mediante `scripts/check_integrations.py` y el gateway completo con cuentas desechables mediante `scripts/check_dashboard_live.py`. No se crearon cuentas operativas ni se modificaron equipos. La comprobación encontró datos utilizables en FortiGate y OmniVista, pero las rutas upstream de VLANs, topología, notificaciones y versión entregan contenido no JSON. Ahora producen un error explícito en vez de inventar colecciones vacías. **No se declara compatibilidad del 100 % ni se simulan esas cuatro fuentes.**

Correcciones: límite efectivo de sesiones; rechazo de HTTP fallido y de fuentes de logs fallidas; salud que exige confirmación del equipo; contrato VLAN consistente; totales desconocidos como `null`; prefijo suficiente para páginas posteriores de cuentas/terminales, con límite de 10,000 registros y sin fingir una paginación completa del proveedor. La búsqueda remota de directorio sigue siendo acotada al prefijo recuperado.

Retención autorizada expresamente: únicamente métricas agregadas durante **30 días**. El servidor toma muestras cada cinco minutos de capacidad/concesiones DHCP, CPU, memoria, conteo de sesiones y cantidad de equipos de infraestructura. No persiste IPs, MACs, cuentas, destinos, URLs ni logs de tráfico. Elimina muestras vencidas en cada colección/lectura; no rellena huecos ni convierte fallos en cero. Las copias externas de la base requieren la misma política de retención.

Pendientes del roadmap que no deben confundirse con estas vistas: reconciliación confiable por ámbitos/VDOM e IDF, paginación nativa completa de OmniVista, topología compatible con esta instalación, integración SSO/MFA institucional y operaciones de alta en equipos (las APIs actuales son de consulta). Requieren contratos o decisiones adicionales; no se habilitan escrituras de red por inferencia.

La base local encontrada no contiene cuentas. La primera cuenta debe crearse mediante el bootstrap interactivo documentado, sin contraseñas predeterminadas. Al arrancar `server.py`, las claves existentes de las APIs locales se reutilizan únicamente para sus URLs loopback exactas; un destino personalizado exige configuración explícita. Las conexiones guardadas mantienen precedencia.

## Conclusión ejecutiva

SGRS puede evolucionar de un inventario con bitácora a una consola de operación y diagnóstico de red sin empezar otra integración desde cero. El código declara **42 operaciones en los routers de las dos APIs: 23 Forti y 19 Omni**. Ocho corresponden a autenticación; las otras **34 son consultas de datos, catálogos o diagnóstico**. No se incluyen en ese conteo las rutas de documentación, redirecciones y liveness declaradas directamente en las aplicaciones, ni las rutas locales del dashboard.[^1][^2]

El frontend utiliza, directamente o mediante el gateway, cinco de esas 34 rutas: dispositivos Forti, pools DHCP, perfil de tráfico de una IP y los dos diagnósticos autenticados. Las dos últimas rutas de salud se reducen principalmente a indicadores de respuesta. No hay todavía una pantalla alimentada por el directorio, inventario, alarmas o topología de OmniVista. Esta es una medida de cobertura de rutas, **no un porcentaje de información realmente aprovechada**: un endpoint puede devolver varios conjuntos, y muchos campos todavía no se presentan.[^3]

La primera prioridad no debería ser agregar más indicadores. Hay problemas de integridad en paginación, clasificación de estados y propagación de errores que pueden producir totales incompletos o una apariencia de normalidad cuando falta información. La segunda prioridad es incorporar redes e inventario reconciliado; después, monitoreo e investigación técnica con acceso reservado. Las páginas propuestas en este informe son un plan de implementación, no funcionalidades ya instaladas.

El modelo de acceso aprobado conserva tres roles reales: `viewer`, `admin` y `super-admin`. El último se presenta a su titular como **Superusuario** y permanece fuera del catálogo de roles de las cuentas operativas. Administrador es el nivel de administración operativa visible para ejecutivos. No hay permisos Linux, ejecución de comandos, contraseña universal ni elevación temporal implícita.

## Alcance y grado de certeza

Los hallazgos describen el código disponible en el repositorio. No constituyen una certificación de compatibilidad con el FortiOS o el OmniVista instalados: no se dispone de respuestas operativas verificadas, versión efectiva, licencias, ámbitos de las credenciales ni documentación exportada de esos equipos. Los esquemas tipados permiten identificar campos previstos; los objetos `Any` y diccionarios abiertos solo permiten identificar una intención de consulta.

“Aprovechar el 100%” debe significar que cada conjunto expuesto tiene un uso, responsable, contrato y política de acceso, no que todos sus campos se envíen a todos los usuarios. Contraseñas, tokens, PSK y detalles personales innecesarios quedan excluidos incluso de una ficha técnica. Una ruta disponible en el código no prueba que todos los equipos o registros puedan recuperarse mediante ella.

Se distinguen tres niveles de evidencia:

- **Implementado:** existe ruta, transformación y/o consumidor identificable en el código.
- **Propuesto:** producto o corrección que requiere desarrollo adicional.
- **Por confirmar:** contenido, compatibilidad o semántica que requiere documentación y muestras de la instalación.

## Arquitectura y contratos actuales

El navegador React consulta al gateway Python mediante `/api`. Este conserva cuentas y conexiones en SQLite y reportes/inventarios en archivos locales; las credenciales de integración permanecen en servidor. Forti utiliza un cliente HTTPX asíncrono hacia FortiOS. Omni utiliza un servicio propio con `requests.Session`; el archivo `omnivista_client.py` es una utilidad paralela, no el servicio inyectado por los routers actuales.[^3][^4][^5]

Las rutas de negocio de ambas APIs son GET. Algunos GET de Omni ejecutan POST contra el NMS para consultar listas paginadas; ese POST de búsqueda no equivale a crear usuarios ni modificar equipos. Actualmente no hay contratos de alta UPAM, asignación real de VLAN, modificación de reglas, desconexión de clientes, reinicio de AP o reconocimiento remoto de alarmas. Las altas y liberaciones del inventario local no deben confundirse con cambios efectivos en la red.

Las APIs aceptan claves de integración y, opcionalmente, JWT emitidos por su flujo TOTP. No interpretan los roles locales del dashboard. Cuando `ENABLE_2FA` está activo, la clave simple deja de bastar y se exige un JWT con `2fa_verified`; guardar una clave en Conexiones no resuelve ese flujo. Basic tampoco está implementado en estos guards: sirve únicamente si se coloca un intermediario que lo acepte.[^6]

Los perfiles de acceso de OmniVista pertenecen a la red; los roles viewer/admin/Superusuario pertenecen a SGRS. No deben mezclarse en un selector ni derivarse unos de otros. Tampoco debe confundirse una cuenta UPAM con una cuenta administradora del NMS.

## Inventario completo de consultas

Todas las rutas de estas tablas tienen el prefijo `/api/v1` en su microservicio. “Reservado” significa que el acceso completo permanece para Superusuario; cualquier resumen ejecutivo futuro deberá contar con una respuesta reducida propia, no con acceso directo al objeto original. Los campos resumidos no sustituyen los esquemas de las fuentes.

### FortiGate: 19 consultas

| Ruta GET | Información prevista | Uso actual | Destino propuesto y límite |
| --- | --- | --- | --- |
| `/devices` | MAC, IP, hostname, fabricante/familia, SO/versión, interfaz, última actividad, online; totales globales y filtrados | Listado adaptado | Inventario unificado; separar estado observado de inferido |
| `/devices/{mac_or_ip}` | Ficha de un dispositivo con esos mismos campos | Sin consumidor específico | Detalle técnico reservado; unión exacta por identidad |
| `/network/dhcp-pools` | Rangos, capacidad, leases, libres, saturación, gateway, máscara, interfaz, duración de concesión | Tarjetas y resumen parcial | Red/IPAM y capacidad; validar conteo por rango |
| `/network/dhcp-leases` | IP, MAC, hostname, interfaz, expiración, estado | Sin pantalla | Concesiones y conciliación IPAM; detalle reservado |
| `/network/arp-table` | IP/MAC/interfaz/estado o edad | Sin pantalla | Evidencias de presencia y discrepancias; reservado |
| `/network/interfaces` | Link, IP, velocidad, bytes, paquetes y errores TX/RX | Sin pantalla | Infraestructura y capacidad; detalle reservado |
| `/system/status` | Hostname, serial, firmware/build, uptime, modo HA, VDOM habilitado | Solo consulta indirecta en health | Ficha del firewall; reservado |
| `/system/resources` | CPU, memoria, disco, sesiones | Sin pantalla | Salud y series históricas; resumen ejecutivo separado |
| `/system/firmware` | Objeto abierto de firmware/particiones | Sin pantalla | Mantenimiento técnico; esquema por confirmar |
| `/firewall/policies` | ID, nombre, interfaces/objetos origen y destino, servicios, acción, estado, NAT, horario, log y comentario | Sin pantalla | Revisión de políticas, solo lectura reservada |
| `/firewall/addresses` | Nombre, tipo, subred, FQDN/rango, comentario | Sin pantalla | Objetos y dependencias de políticas; reservado |
| `/firewall/address-groups` | Nombre, miembros y comentario | Sin pantalla | Resolver grupos y referencias; reservado |
| `/traffic/sessions` | Origen/destino, puertos, protocolo, aplicación, policy ID, duración, bytes y expiración | Sin pantalla propia | Tráfico activo; reservado y acotado |
| `/traffic/destinations` | Destino, sesiones, bytes, puertos y clientes | Sin pantalla | Destinos observados; reservado, no ranking total de la red |
| `/traffic/logs` | Fecha, IPs, usuario/host, dominio/URL, servicio, acción, categoría, bytes | Sin pantalla | Investigación de eventos recientes; reservado |
| `/traffic/ip/{ip}` | Sesiones, contadores por dirección, logs recientes y destinos principales | Modal parcial: contadores y lista breve | Ficha técnica con pestañas; reservado |
| `/vpn/ipsec` | Túnel, estado, gateway remoto, bytes y comentarios | Sin pantalla | VPN por sede; detalle reservado |
| `/vpn/ssl-sessions` | Usuario, IP de túnel, host remoto, duración y bytes | Sin pantalla | Acceso remoto; reservado por identidad y sensibilidad |
| `/health` | Vida de API, configuración y conectividad/autenticación del firewall | Indicador y prueba de conexión | Diagnóstico por capas; detalle reservado |

Fuentes: routers, cliente FortiOS y esquemas locales.[^1][^4][^7][^8]

Los filtros más relevantes son `status`, `online_only`, `active_window` entre 60 y 86400 segundos, fabricante, búsqueda e interfaz para dispositivos; `vdom` en las consultas de datos; acción/estado para reglas; origen, destino y puerto para sesiones; hostname/IP para logs; y dirección para la ficha de tráfico. No hay filtro de fechas general expuesto para navegación histórica ni paginación pública de la tabla de sesiones. El perfil por IP acepta `limit` 5–200, pero consulta primero hasta 1000 sesiones globales.[^7][^8]

### OmniVista: 15 consultas

| Ruta GET | Información prevista | Uso actual | Destino propuesto y límite |
| --- | --- | --- | --- |
| `/employees` | Usuario, nombre, contacto, departamento, puesto, perfil/políticas, estado y vigencia | Ninguno | Directorio de acceso a red reservado; agregados por área evaluables |
| `/employees/{username}` | Ficha UPAM por usuario | Ninguno | Relación cuenta/terminales; búsqueda actualmente incompleta |
| `/company-properties` | MAC, nombre, cuenta, categoría/familia/SO, perfil/políticas, estado, última autenticación, AP/SSID/ubicación | Ninguno | Terminales autorizados y ficha de activo; reservado |
| `/company-properties/{device_mac}` | Ficha por MAC normalizada | Ninguno | Conciliación autorizado/observado; corregir búsqueda |
| `/catalogs/access-role-profiles` | Lista de nombres de perfiles | Ninguno | Catálogo de redes/perfiles; no prueba por sí solo todos los SSIDs |
| `/catalogs/device-options` | Categorías, familias y sistemas operativos estáticos | Ninguno | Selectores consistentes; no son descubrimiento del NMS |
| `/catalogs/vlans` | Listado upstream de VLANs con envoltorio tipado incongruente | Ninguno | Redes disponibles; contrato bloqueante antes de usar |
| `/monitoring/infrastructure-stats` | Totales de equipos, AP, switches, otros, empleados y MACs | Ninguno | Resumen operativo; corregir conteo y clasificación |
| `/monitoring/devices` | Diccionarios de switches/AP; IP y modelo/nombre usados por el servicio | Ninguno | Infraestructura; normalizar con muestras reales |
| `/monitoring/devices/{ip_address}` | Diccionario de un equipo por IP | Ninguno | Ficha técnica de infraestructura; reservado |
| `/monitoring/online-devices` | Diccionarios de terminales autenticados | Ninguno | Acceso activo/RADIUS; tope actual de 200 |
| `/monitoring/topology` | JSON abierto de topología | Ninguno | Mapa reservado si hay enlaces reales; vista tabular alternativa |
| `/monitoring/notifications` | JSON abierto de notificaciones | Ninguno | Alarmas; clasificación y deduplicación por confirmar |
| `/system/health` | Estado de enlace, latencia, modo de autenticación y host | Indicador y prueba de conexión | Diagnóstico separado de liveness |
| `/system/version` | JSON abierto de versión | Ninguno | Mantenimiento de NMS; reservado |

Fuentes: routers, servicio y esquemas locales.[^2][^5][^9]

Empleados y terminales permiten `page`, `page_size` de 1–500 y búsqueda de hasta 100 caracteres. Las rutas de detalle consultan internamente listas mayores; no son búsquedas directas garantizadas contra el proveedor. Topología y notificaciones no tienen esquema estable, filtros de tiempo, cursor ni contrato de orden en el adaptador actual.

### Ocho operaciones de autenticación

Ambas APIs tienen GET `/auth/status` y POST `/auth/setup-2fa`, `/auth/verify-2fa`, `/auth/verify-token`. Son cuatro operaciones por API, no ocho fuentes de métricas. Setup requiere la clave y que el enrolamiento esté habilitado; entrega un secreto TOTP. Verify emite un JWT. Ninguna de ellas es un CRUD de usuarios SGRS.[^6]

El gateway no publica estos flujos por proxy. Para el dashboard se conservan `/api/auth/session`, `/login` y `/logout` con sus cuentas locales. La evolución institucional debería resolver autenticación humana y autenticación servicio-a-servicio por separado, sin entregar al ejecutivo la clave de integración para que construya su propio token.

## Hallazgos que condicionan el dashboard

### Totales incompletos de OmniVista — prioridad crítica de datos

`get_employee_accounts` y `get_company_properties` siempre envían `start: ""` al proveedor. Solicitan `page_size`, o cinco veces ese tamaño si hay búsqueda, y después aplican el índice de página sobre ese mismo bloque. Sin búsqueda, la página 2 puede quedar vacía aunque existan más registros; `total` es la longitud del bloque descargado, no el total del directorio.[^5]

`get_infrastructure_stats` solicita ambos directorios con `page_size=1`. Si el upstream respeta `querySize`, los contadores de empleados y MACs serán 0 o 1. Además, la detección de AP/switch por fragmentos de texto puede contar un dispositivo en ambas categorías. No deben publicarse esos indicadores como población institucional hasta corregir la paginación y volver mutuamente excluyente la clasificación.

La búsqueda por MAC normaliza la entrada, pero filtra texto sobre el MAC upstream sin garantizar la misma normalización; puede no encontrar valores separados por dos puntos. El contrato nuevo debe normalizar ambos lados y distinguir “no encontrado en búsqueda completa” de “no encontrado en el bloque recibido”.

### Vacío, error y desactualización se confunden — prioridad crítica de datos

Varias operaciones Omni retornan `[]` ante HTTP no satisfactorio; topología y notificaciones también ante JSON inválido. Sus routers pueden envolver ese vacío en `success=True`. Forti hace algo similar al absorber excepciones de inventario y de logs. Un tablero de “0 alarmas” o “0 usuarios conectados” puede por tanto estar informando un fallo como si fuese una medición.[^5][^7][^8]

El gateway de dispositivos sustituye respuestas fallidas o un inventario remoto legítimamente vacío por el archivo local y no añade procedencia explícita. `/api/devices/summary` puede entregar una lista en vez de un objeto cuando no hay resumen remoto. La fecha global de actualización del frontend tampoco equivale a una fecha observada individual por fuente.[^3]

Corrección propuesta: conservar los fallos como fallos, incluir estado parcial y antigüedad por conjunto, y separar el inventario local del observado. `null` debe significar desconocido; `0` requiere una consulta satisfactoria con semántica conocida.

### DHCP e identidad de red — prioridad alta

La ocupación DHCP se agrupa por interfaz y se aplica a cada servidor de esa interfaz. Con varios scopes puede duplicar concesiones entre pools; el total global incorpora todas las entradas de leases aunque no pertenezcan a los servidores habilitados considerados. La capacidad suma rangos inclusivos, sin descontar reservas/exclusiones ni resolver solapamientos. Además, la configuración usa `root` si no se manda VDOM, mientras otras llamadas respetan el VDOM predeterminado del cliente.[^7]

“IPs libres del pool” no significa “IPs libres de toda la subred” ni “IPs que SGRS puede asignar”. Se necesita una conciliación por VDOM, interfaz y pertenencia al rango, con política para reservas y direcciones estáticas. Una entrada ARP prueba una observación, no la identidad definitiva o el inventario completo de una persona.

### Tráfico y presencia — prioridad alta

Las sesiones se filtran después de descargar una muestra. Destinos agrupa hasta 500 sesiones; la ficha IP inspecciona hasta 1000. Cambiar `limit` no da acceso a todas las sesiones existentes. Los logs prueban disk, memory y FortiAnalyzer y devuelven la primera fuente con resultados, sin combinar todas ni informar claramente cuál fue seleccionada.[^4][^8]

El perfil por IP puede sustituir contadores de sesiones por bytes de logs recientes cuando no tiene volumen de sesiones, sin identificar ese cambio de base. También conserva la semántica origen/destino de bytes aunque el equipo consultado sea el destino: no debe presentarse como subida/bajada del equipo sin normalización. La deduplicación de logs por combinación de campos puede colapsar eventos distintos; conviene usar el identificador del proveedor cuando exista.

La clasificación online de dispositivos usa recencia respecto al mayor `last_seen` del inventario, no necesariamente respecto al reloj actual. Un inventario entero antiguo puede parecer reciente respecto a sí mismo. Una respuesta válida vacía de `unified_latest` y una consulta fallida terminan sin conjunto activo utilizable; tampoco todos los timestamps string se interpretan como timestamps numéricos. La afirmación de equivalencia exacta con el widget FortiOS en comentarios no queda demostrada por este algoritmo.[^8]

En VPN, el fallback de IPsec infiere `up` por bytes entrantes mayores a cero. Un contador acumulado no acredita que el túnel siga activo. Debe prevalecer el estado reportado; si falta, mostrar desconocido.[^1]

### Campos declarados que no son datos confirmados — prioridad alta

`SystemResourceUsage.session_limit` existe en el esquema, pero el router no lo llena. `/system/status` calcula un modelo localmente y no lo incorpora al modelo de respuesta. No se debe diseñar una barra “sesiones usadas / capacidad máxima” ni una ficha con modelo obligatorio a partir de estas rutas tal como están.[^1]

El catálogo VLAN de Omni declara una lista de envoltorios `{vlans,total}`, pero el servicio entrega la lista upstream sin transformarla. Si esta contiene objetos planos `{vlanId,vlanName,...}`, el modelo puede ignorar esos atributos y devolver envoltorios vacíos. `VlanItemResponse` existe pero no se usa en la respuesta de la ruta. Este contrato exige corrección antes de conectar tarjetas de VLAN.[^9]

Los catálogos de tipo de dispositivo son valores escritos en el servicio. Algunos defaults de Company Property, como SO Android o estado Offline, tampoco acreditan observación cuando el upstream omite el campo. El saneamiento por nombre que contiene `psk` enmascara incluso un indicador como `enableDeviceSpecificPSK`: proteger el secreto debe ser distinto de conservar una bandera no secreta correctamente tipada.[^5][^9]

### Salud, rendimiento y autenticación — prioridad alta

Forti `/health` devuelve `success=True` para indicar que la API funciona aunque `fortigate_connection.reachable` sea falso. Omni `/system/health` expresa fallo en el JSON manteniendo normalmente HTTP 200. El indicador global solo comprueba HTTP, y la prueba Forti tampoco verifica todas las banderas del equipo. La interfaz actual advierte correctamente que respuesta de API no certifica infraestructura; una nueva vista debe separar gateway, microservicio, autenticación upstream y lectura de cada recurso.[^3][^10]

Los tiempos del gateway (1.5 s en salud, 3 s para dispositivos, 4 s en proxy) son menores que varios timeouts upstream Omni (8–12 s), con login adicional de hasta 12 s. Un enlace sano pero lento puede aparecer caído. Es necesario presupuestar el tiempo de extremo a extremo, cancelar trabajo pendiente y compartir caché entre clientes, no simplemente aumentar todos los límites.

El singleton Omni comparte sesión y cabeceras, y login retira/reemplaza Authorization. La renovación concurrente necesita coordinación; la seguridad frente a carreras no está demostrada por este servicio. Forti ya ejecuta dos consultas de fondo cada minuto sin persistir sus resultados: ese keepalive no crea históricos aprovechables por las gráficas.[^4][^5][^11]

## Diseño funcional propuesto

### Dashboard ejecutivo

Conservar la identidad ISSSTE existente y concentrar la portada en capacidad, continuidad e incidencias. Mostrar pools próximos al umbral, equipos observados y autorizados por separado, incidentes IDF pendientes y salud resumida de fuentes. Cada cifra debe abrir su listado de respaldo con los mismos filtros y señalar la fecha observada.

No publicar porcentajes de disponibilidad mensual, variación respecto a ayer o tendencias mientras no exista una serie histórica. Los agregados nuevos para admin/viewer requieren respuesta propia y política aprobada; no se concede acceso al proxy técnico para llenar una tarjeta. La pantalla móvil IDF sigue dedicada al registro; en escritorio permanece de consulta.

### Redes e IPAM

Extender Redes disponibles con ficha por red: capacidad DHCP, rangos y concesiones; comparación con asignaciones locales; y evidencia ARP solo en el contexto técnico autorizado. Las discrepancias prioritarias serían IP local marcada libre pero observada, MAC con múltiples IPs y concesión fuera de un rango configurado. Cada discrepancia debe mostrar sus observaciones y hora, no diagnosticar automáticamente un ataque.

Las acciones locales conservarán el texto “inventario local”. Aplicar una reserva o cambiar VLAN en el equipo requerirá APIs de escritura, revisión de permisos del proveedor y un flujo de cambio separado. El catálogo Omni de perfiles puede respaldar solicitudes, pero no convierte la actual demo de altas en un aprovisionamiento real.

### Inventario unificado

Separar tres clases: terminal descubierto por Forti, terminal autorizado en Company Property e infraestructura administrada por Omni. Una ficha reunirá datos comunes y procedencia, sin sumar ciegamente los totales de las tres fuentes. La ausencia en una fuente debe marcarse como “sin coincidencia en la cobertura disponible”, no como “equipo no autorizado” si la consulta es parcial.

La unión inicial se propone por MAC normalizada más ámbito; IP queda como observación temporal, y nombre como indicio secundario. MAC aleatoria, interfaces múltiples y direcciones reutilizadas exigen confianza de coincidencia y posibilidad de revisión. Los recursos físicos de IDF mantienen sus identificadores locales y se vinculan explícitamente con el activo externo; no se infiere el gabinete solo por el hostname.

### Infraestructura y topología

Crear listado de switches/AP con estado, modelo cuando exista, ubicación, última observación y enlace a su ficha. La ficha técnica incorpora interfaces Forti únicamente donde exista relación confirmada, firmware, uptime y recursos del firewall. No se atribuyen los contadores del FortiGate a todos los switches de OmniVista.

La topología tendrá una vista de relaciones y una tabla accesible de nodos/enlaces, con búsqueda y detalle. Primero se debe confirmar que el JSON de `/topology` entrega enlaces y sus tipos. Si solo entrega nodos, se presentará un catálogo de nodos; no se dibujarán conexiones físicas inventadas. PoE, potencia óptica, LLDP, vecinos por puerto y capacidad RF siguen por confirmar, no están garantizados por los modelos actuales.

### Alarmas e incidencias

Crear una bandeja técnica con origen, severidad, equipo, primera/última observación y detalle de notificación. El contrato de alarmas debe definir un identificador estable antes de deduplicar. Relacionar una alarma con una incidencia IDF es una acción local trazable; resolver esa incidencia no reconoce ni elimina la alarma en el NMS.

El resumen ejecutivo puede mostrar cantidades o incidentes operativos aprobados sin incluir cuerpos de eventos técnicos. No hay todavía SLA verificable, historial de cambios de severidad ni contrato remoto para “Reconocer alarma”. Esos elementos serán fases posteriores.

### Directorio y acceso a red

Crear una sección reservada con pestañas Cuentas UPAM, Terminales autorizados, Sesiones de acceso y Perfiles. Presentará vínculos entre username/account, MAC, perfil, última autenticación, AP, SSID y ubicación solo cuando las fuentes lo informen. Los contactos y políticas no se enviarán a viewer; por defecto el detalle completo tampoco se abrirá al ejecutivo admin.

Los indicadores de cuentas por área o perfil podrían alimentar una respuesta ejecutiva agregada después de corregir los totales y aprobar su alcance. No mostrar ni recuperar passwords/PSK. No usar esta sección para crear cuentas SGRS: Usuarios y privilegios continúa como administración local independiente.

### Tráfico, seguridad y VPN

Crear Tráfico con sesiones, destinos, logs y ficha por IP. La interfaz distinguirá instantánea de sesiones, volumen observado en esas sesiones y eventos recientes; mostrará límites de muestra y fuente de logs. Los filtros de fecha solo se incorporarán cuando el backend los implemente; una IP o dominio observado no demuestra una visita humana ni el contenido de una comunicación cifrada.

Crear Seguridad con políticas, objetos y grupos enlazados por sus nombres/IDs. Señalar reglas amplias, logging deshabilitado o referencias no resueltas como candidatos de revisión, no como vulnerabilidades concluyentes. No hay datos suficientes para calcular uso histórico de reglas, política efectiva completa o detección exhaustiva de shadowing.

Crear VPN con túneles IPsec y sesiones SSL separadas. Un superusuario podrá investigar usuario, gateway, duración y contadores sin ofrecer desconexión o cambio de configuración. Los tres módulos permanecen reservados y no generan tarjetas bloqueadas ni promociones de permisos en la interfaz ejecutiva.

### Centro técnico y reportes históricos

Ampliar Conexiones, al pie del sidebar autorizado, con estado por API/recurso, última consulta satisfactoria, latencia y diagnóstico sanitizado. Distinguir credencial configurada, API autenticada, upstream disponible y recurso soportado. Una prueba de conexión no debe lanzar automáticamente las 34 consultas.

Los reportes históricos requieren un recolector del servidor y almacenamiento separado de las sesiones web. Se propone preservar muestras de capacidad/estado y referencias de eventos, más exportaciones acotadas por permiso. La retención de logs de navegación, datos personales y evidencias deberá aprobarse antes de recolectarlos automáticamente; no se presupone permiso para guardar indefinidamente toda respuesta.

## Contrato de integración propuesto

Una respuesta normalizada debería incluir `data`, `source`, `observed_at`, `fetched_at`, `scope`, `completeness`, `warnings` y, cuando aplique, `pagination`. `completeness` distingue `complete`, `partial` y `unknown`; `total` podrá ser nulo si no se conoce. El esquema tendrá versión y una lista explícita de campos permitidos por rol. Esta propuesta es un contrato nuevo, no un formato que las APIs ya entreguen.

Las métricas deben declarar unidad y base de cálculo. Para velocidad, usar diferencias de contadores entre observaciones válidas: `8 × delta_bytes / delta_seconds`; si el contador reinicia o la observación falta, el intervalo se marca desconocido. Nunca convertir bytes acumulados en Mbps dividiendo por una constante arbitraria.

El recolector propuesto consulta una vez por ámbito y reutiliza resultados, en lugar de multiplicar las llamadas por cada navegador. Como punto de partida sujeto a medición: recursos/interfaces cada 30–60 s, inventario cada 1–5 min y catálogos/configuración cada 15–60 min; tráfico detallado bajo demanda. Estos intervalos no son límites certificados de los proveedores. Aplicar concurrencia limitada, backoff con jitter ante fallos, presupuesto por servicio y caché separada por ámbito y proyección.

Las nuevas rutas del gateway deberían representar necesidades de producto, por ejemplo `/api/network/segments`, `/api/assets`, `/api/infrastructure`, `/api/alerts`, `/api/access-directory` y `/api/security/policies`. Son nombres propuestos, no endpoints existentes. Las rutas de investigación reservada conservarán autorización servidor por cada llamada y no aceptarán URL, método o ruta upstream arbitrarios desde el navegador.

## Superusuario interno y jerarquía visible

### Política aplicada

| Aspecto | Viewer | Administrador | Superusuario interno |
| --- | --- | --- | --- |
| Catálogo recibido en sesión | Viewer y Administrador | Viewer y Administrador | Los tres roles |
| Operación local de inventario/IDF | Consulta | Consulta y escritura autorizada | Mismas capacidades más administración interna |
| Listar/crear/editar cuentas SGRS | No | No | Sí |
| Ver cuentas del nivel interno y asignarlo | No | No | Sí |
| Configurar/probar conexiones | No | No | Sí |
| Consultas técnicas adicionales por proxy | No | No | GET de la lista autorizada |
| Cambiar equipos externos o ejecutar comandos | No | No | No existe esa funcionalidad |

El administrador conserva sus permisos operativos y puede recibir por separado la consulta, creación, edición y eliminación de cuentas. La herencia de permisos y la jerarquía se validan en el servidor; las cuentas visibles pueden consultarse sin exponer las cuentas ocultas ni convertir la interfaz en el control de seguridad. Las conexiones siguen reservadas al permiso de integración del nivel superior.

La implementación mueve el catálogo real de roles al servidor y lo proyecta según la identidad autenticada. Login y consulta de sesión usan la misma función. El frontend deja de distribuir el nombre y la definición del rol interno como constantes; los recibe solo en una sesión autorizada. Los errores públicos son genéricos y la telemetría reservada se omite del detalle del dispositivo para quienes no tienen permiso. La demo pública representa un administrador operativo, no un superusuario.[^12]

La gestión de cuentas y conexiones continúa comprobándose en servidor. El proxy cambia de patrón de ruta amplio a una lista explícita de lecturas conocidas y patrones acotados para los detalles. Una ruta futura del microservicio no queda automáticamente habilitada. No se permite enrolamiento TOTP, documentación ni mutaciones externas a través de ese proxy.

La protección debe seguir el principio de mínimo privilegio, denegar por defecto y verificar cada solicitud, no depender de que el menú sea difícil de encontrar. OWASP distingue autenticación de autorización y recomienda esos controles en el servidor.[^13]

### Límite de la discreción

La aplicación puede omitir el rol, cuentas y funciones internas de las vistas y respuestas operativas; no puede garantizar que su existencia sea imposible de inferir para alguien con acceso al repositorio, al servidor, a copias antiguas del frontend o a una sesión interna. El bundle compartido todavía contiene lógica de pantallas administrativas, aunque ya no contiene el catálogo interno. La ausencia del nombre del rol no es una frontera criptográfica.

Si se requiere ocultar también la estructura de la herramienta técnica frente a inspección del bundle, la siguiente fase es un frontend/despliegue interno separado y restringido por red y autenticación, sin entregar esos módulos a ejecutivos. No basta cargar dinámicamente un chunk si su URL sigue siendo pública. Este informe y los manuales técnicos también deberán circular solo entre responsables del sistema; no deben publicarse como ayuda para ejecutivos.

La auditoría conservará la identidad real de quien actúa. No se sustituyen autores ni se borran eventos para ocultar el nivel interno. Las bitácoras técnicas pueden tener acceso restringido, manteniendo atribución, resultado y correlación, sin passwords ni tokens. OWASP recomienda registrar eventos de usuarios internos y proteger tanto los datos sensibles como el acceso a los logs.[^14]

### Refuerzos pendientes

Quedan pendientes MFA personal, ámbitos por sede/IDF/VDOM, credenciales de servicio limitadas, cifrado/almacén de secretos y auditoría de consultas sensibles. Las credenciales API locales actuales son recuperables en SQLite con permisos de archivo, no cifradas en reposo. Ningún ejecutivo debe recibirlas ni tener acceso directo a los puertos de los microservicios.[^12]

La minimización viewer actual elimina campos por nombre, no mediante esquemas completos por recurso; un hostname renombrado como `name` puede sobrevivir. No se debe reutilizar esa técnica como garantía general para las nuevas páginas. Además, la autorización por ruta no sustituye validar parámetros: `vdom` necesita un ámbito autorizado, no únicamente una expresión regular.

## Información adicional por explorar, no confirmada

El cliente Forti ya admite seleccionar tipos de log webfilter, app-ctrl y event, y recibe `start` y filtro para logs; los routers de tráfico actuales no exponen toda esa capacidad. Podría ampliarse la investigación de eventos UTM y sistema después de validar disponibilidad, formato, licencia y permiso. Esto no equivale a una nueva fuente operativa ya integrada.[^4]

La utilidad `query_omnivista.py` enumera posibles rutas `/api/events`, `/api/config/backups`, `/api/inventory/chassis`, `/api/ports`, `/api/wlan/ssids`, `/api/wlan/aps` y `/api/ca_openapi`. El cliente auxiliar también contiene `/api/users`. Son pistas de exploración, no contratos confirmados ni rutas expuestas por el servicio FastAPI actual. No se recomienda conectarlas automáticamente, especialmente backups o cuentas del NMS.[^15]

La evidencia necesaria para esa ampliación es una exportación de esquema/documentación de la versión instalada y muestras sanitizadas de éxito, vacío, error y segunda página. No hacen falta secretos ni volcados indiscriminados. Sin esa evidencia, diagramas por puerto, mapas RF, backups y administración del NMS permanecen fuera del compromiso funcional.

## Secuencia de implementación

| Etapa | Entregable | Condición de salida |
| --- | --- | --- |
| 0. Separación de acceso | Catálogos de rol proyectados, demo operativa, errores neutrales y proxy explícito | Implementación local incluida; validación funcional y de seguridad pendiente |
| 1. Integridad de contratos | Paginación Omni, VLANs, totales, errores, procedencia, salud y ámbitos | Fixtures de múltiples páginas, fallos y datos incompletos no producen totales falsos |
| 2. Redes e inventario | Redes/IPAM y conciliación de activos | Cada cifra trazable a fuente, hora y cobertura; sin cambios remotos implícitos |
| 3. Monitoreo | Infraestructura, alarmas y topología condicionada | Estados desconocidos visibles; relaciones confirmadas; no alarmas vacías por error |
| 4. Investigación reservada | Directorio, tráfico, firewall y VPN | Acceso negativo verificado en backend y UI; consultas sensibles auditadas |
| 5. Históricos e informes | Recolector, almacenamiento, reportes y exportación | Retención aprobada, continuidad y huecos de datos visibles, pruebas de recuperación |
| 6. Extensión del proveedor | Nuevas fuentes confirmadas por documentación instalada | Contrato, permiso y fixtures antes de habilitar una ruta |

El orden reduce el riesgo de construir pantallas sobre contratos que luego deban rehacerse. La duración depende sobre todo de obtener muestras y paginación reales, no del número de componentes React. No hay base suficiente para comprometer cobertura operativa total o una fecha de integración sin esas dependencias.

## Criterios de aceptación y estado de entrega

Para cerrar cobertura, cada una de las 34 consultas debe tener una ficha de contrato: campos usados/omitidos y motivo, consumidor, permisos, filtros/ámbito, paginación o límite, unidad, procedencia, errores, política de retención y ejemplos sanitizados. El catálogo estático se identifica como estático; los endpoints de autenticación se justifican como infraestructura y no se fuerzan dentro de una gráfica.

Para cerrar confidencialidad, una cuenta admin/viewer no recibe el rol interno ni cuentas internas en login/sesión, búsquedas o exportaciones; no accede por URL directa ni petición manual a usuarios, conexiones o consultas reservadas; no escala enviando otro rol; y una revocación invalida acceso previo. El superusuario conserva acceso a las funciones asignadas y la protección contra desactivar la última cuenta responsable. La ausencia de referencias en la demo y en el bundle se revisa por separado de la autorización efectiva.

La entrega incorpora el ajuste de visibilidad y la lista explícita de consultas del gateway. No modifica las APIs Forti/Omni, no crea las páginas propuestas y no cambia cuentas o credenciales existentes. El identificador almacenado `super-admin` se conserva para compatibilidad. Cargar el código nuevo requiere reiniciar el gateway y recargar el frontend compilado; no se necesita migrar las cuentas.

La compilación y la revisión estática no acreditan funcionamiento contra equipos ni validación de seguridad. Los casos preparados en `tests/test_dashboard_access.py` y `Dashboard/tests/browser.mjs` deben ejecutarse en una etapa de validación autorizada; las capturas previas no prueban el contrato de roles actualizado.

## Fuentes

Fuentes de código de SGRS consultadas para esta revisión; son evidencia privada del repositorio, no documentación oficial del fabricante. Las referencias externas son de OWASP. Fecha de consulta: 10 de septiembre de 2026.

[^1]: SGRS. Routers Forti: [sistema](</home/vivaceash/Projects/SGRS/API Forti/app/routers/system.py:60>), [firewall](</home/vivaceash/Projects/SGRS/API Forti/app/routers/firewall.py:40>), [VPN](</home/vivaceash/Projects/SGRS/API Forti/app/routers/vpn.py:39>) y demás routers citados abajo. Esquemas en `API Forti/app/schemas/`.
[^2]: SGRS. Routers Omni: [empleados](</home/vivaceash/Projects/SGRS/API Omni/app/routers/employees.py:22>), [terminales](</home/vivaceash/Projects/SGRS/API Omni/app/routers/company_properties.py:21>), [catálogos](</home/vivaceash/Projects/SGRS/API Omni/app/routers/catalogs.py:21>), [monitoreo](</home/vivaceash/Projects/SGRS/API Omni/app/routers/monitoring.py:22>) y [sistema](</home/vivaceash/Projects/SGRS/API Omni/app/routers/system.py:22>).
[^3]: SGRS. [Consumidores React](/home/vivaceash/Projects/SGRS/Dashboard/src/App.jsx:99) y [adaptación de dispositivos/proxy/health](/home/vivaceash/Projects/SGRS/server.py:206).
[^4]: SGRS. [FortiOSClient: transporte y métodos](</home/vivaceash/Projects/SGRS/API Forti/app/clients/fortios.py:79>), especialmente sesiones y fuentes de logs desde línea 204.
[^5]: SGRS. [OmniVistaService: implementación activa](</home/vivaceash/Projects/SGRS/API Omni/app/services/omnivista_service.py:131>), paginación, búsqueda, catálogos, clasificación y diagnóstico.
[^6]: SGRS. [Guard Forti](</home/vivaceash/Projects/SGRS/API Forti/app/core/security.py:205>), [guard Omni](</home/vivaceash/Projects/SGRS/API Omni/app/dependencies.py:196>), [auth Forti](</home/vivaceash/Projects/SGRS/API Forti/app/routers/auth.py:63>) y [auth Omni](</home/vivaceash/Projects/SGRS/API Omni/app/routers/auth.py:63>).
[^7]: SGRS. [Red, DHCP, ARP e interfaces](</home/vivaceash/Projects/SGRS/API Forti/app/routers/network.py:38>) y [modelos de red](</home/vivaceash/Projects/SGRS/API Forti/app/schemas/network.py:1>).
[^8]: SGRS. [Inventario y cálculo online](</home/vivaceash/Projects/SGRS/API Forti/app/routers/devices.py:18>), [sesiones y logs](</home/vivaceash/Projects/SGRS/API Forti/app/routers/traffic.py:93>) y [modelos de tráfico](</home/vivaceash/Projects/SGRS/API Forti/app/schemas/traffic.py:1>).
[^9]: SGRS. [Modelos de empleados](</home/vivaceash/Projects/SGRS/API Omni/app/schemas/employee.py:1>), [Company Property](</home/vivaceash/Projects/SGRS/API Omni/app/schemas/company_property.py:1>) y [catálogos/VLAN](</home/vivaceash/Projects/SGRS/API Omni/app/schemas/catalogs.py:1>).
[^10]: SGRS. [Diagnóstico Forti](</home/vivaceash/Projects/SGRS/API Forti/app/routers/health.py:30>) y [diagnóstico Omni](</home/vivaceash/Projects/SGRS/API Omni/app/routers/system.py:22>).
[^11]: SGRS. [Tarea de fondo y ciclo de vida Forti](</home/vivaceash/Projects/SGRS/API Forti/app/main.py:43>).
[^12]: SGRS. [Identidad, roles y almacenamiento](/home/vivaceash/Projects/SGRS/dashboard_access.py:23), [autorización de rutas](/home/vivaceash/Projects/SGRS/dashboard_routes.py:1) y [manual técnico vigente](/home/vivaceash/Projects/SGRS/USUARIOS_Y_CONEXIONES.md).
[^13]: OWASP Foundation. [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), secciones de mínimo privilegio, denegación por defecto y validación de cada solicitud. Documento mantenido, sin fecha única de publicación indicada.
[^14]: OWASP Foundation. [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), atributos de eventos, datos excluidos y protección del registro. Documento mantenido, sin fecha única de publicación indicada.
[^15]: SGRS. [Utilidad exploratoria Omni](</home/vivaceash/Projects/SGRS/API Omni/query_omnivista.py:61>) y [cliente auxiliar](</home/vivaceash/Projects/SGRS/API Omni/omnivista_client.py:170>); no prueban disponibilidad del proveedor.
