# Revisión de exposición de credenciales

Revisión estática del dashboard, gateway Python, APIs Forti y OmniVista, clientes, configuración y suites locales. No se consultaron los equipos de red. La revisión de transporte del 2026-10-06 incluye pruebas locales y de navegador con fixtures; no acredita un despliegue TLS en producción.

## Comportamiento de F12 durante el acceso

El navegador que inicia sesión puede inspeccionar el cuerpo de su propia petición y ver la contraseña que acaba de enviar. Eso es normal en un acceso con usuario y contraseña: el cliente necesita entregarla al servidor. HTTPS protege el trayecto de red, no oculta la petición al navegador de quien la hizo. Cifrar o aplicar un hash en JavaScript no resuelve este límite.

La respuesta de inicio de sesión no contiene la contraseña ni su hash. El servidor conserva un hash scrypt con sal y entrega la sesión en una cookie `HttpOnly`, `SameSite=Strict`; la cookie no se guarda en `localStorage`. Las respuestas de la API no deben repetir la contraseña. La cuenta inicial se crea por consola salvo habilitación local explícita.

## Cambios realizados en esta revisión

- Las listas de usuarios ahora se autorizan y filtran en el servidor. El superadministrador aparece como administrador normal para administradores operativos; no recibe páginas internas ni indicadores de ocultamiento. Las cuentas ocultas no se enumeran y una modificación directa de su ID obtiene una respuesta indistinguible de una cuenta inexistente. Solo el superadministrador puede ocultar o restaurar cuentas.
- Las referencias a cuentas ocultas se minimizan en respuestas operativas y se retira el token QR de visita de las respuestas que no tienen capacidad para registrar visitas.
- Las credenciales y campos equivalentes se enmascaran en objetos JSON recibidos de Forti/Omni. El proxy evita reenviar cuerpos de error de los equipos. Se limitaron errores que devolvían mensajes internos y se dejaron de imprimir tokens o respuestas de autenticación en utilidades.
- El diagnóstico Forti, los pools DHCP y los endpoints de salud de sistema Omni ahora requieren la clave de servicio. Inventarios también protege su diagnóstico profundo y el inicio de cotejos con permiso de escritura. Se conservan endpoints mínimos de liveness que no consultan la red.
- El modo LAN solicitado conserva HTTP con CIDR y origen explícitos; el proxy HTTPS sigue siendo opcional. La cookie usa `Secure` cuando existe proxy HTTPS, se desactiva el guardado de autorización en Scalar y se endurecen CSP y `Referrer-Policy` del dashboard.
- Los clientes Forti/Omni verifican certificados TLS por defecto. Las claves de integración de producción fueron rotadas y sincronizadas entre APIs, gateway y conexiones guardadas. Activar 2FA requiere un secreto TOTP dedicado; los códigos se derivan por nombre de cuenta desde ese secreto, nunca desde la clave de API.
- Los QR de IDF son permanentes y distintos por IDF: su token se deriva del identificador estable y no depende de archivos de claves ni de expiración. La DB de Inventarios aplica `0600` también a archivos existentes.
- CI ejecuta las suites Python, build/tests del frontend y auditoría npm.
- Las respuestas dejan de almacenar en caché API. El servidor limita archivos servidos a la carpeta compilada, rechaza symlinks que escapan de ella, bloquea métodos de lectura alternativos en la API y excluye query strings de los logs HTTP.

## Revisión de transporte (2026-10-06)

La validación anterior de login y administración aceptaba `Origin` con esquema HTTPS como prueba de cifrado. Esa cabecera es controlada por el cliente y podía acompañar una petición HTTP; además, las consultas autenticadas no tenían la misma restricción. Se sustituyó por una frontera para todas las rutas de cuenta y sesión: el origen público debe coincidir con Host y el proxy local debe indicar `X-Forwarded-Proto: https`. Solo se confía en conexiones desde loopback y el lanzador rechaza enlazar el gateway fuera de loopback cuando se configura un origen público.

Sin origen público, el dashboard admite cuentas desde loopback y desde las redes LAN declaradas en `SGRS_LAN_CLIENT_CIDRS`, siempre que Host y Origin coincidan con `SGRS_LAN_ORIGIN`. `/api/mobile-report` conserva su flujo LAN. [El Caddyfile](deploy/Caddyfile.example) y [las instrucciones](Dashboard/README.md#https-para-acceso-desde-otros-equipos) permiten configurar un proxy real si la infraestructura lo requiere; el despliegue LAN solicitado usa HTTP directo del dashboard.

Se añadieron pruebas de frontera de origen, cabeceras reenviadas falsificadas, cookie Secure cuando aplica, desarrollo local, LAN autorizada y bloqueo del fetch inseguro. Se confirmó por nombres de archivos, sin leer valores, que Git incluye `.env`, los `.env` de APIs y `.sgrs-private/dashboard.sqlite3`. Este riesgo persiste en las copias y el historial; retirar los archivos actuales no revoca secretos ya expuestos. Las credenciales reales que hayan salido del entorno confiable deben rotarse.

Por instrucción del propietario se conservan los `.env` y la base en Git. Los archivos permanecen versionados; las claves de integración fueron rotadas y la DB se sincronizó con las nuevas claves.

La validación histórica de esta revisión queda reemplazada por los resultados de las suites ejecutadas en la entrega actual. Las pruebas contra hardware real y el escaneo de secretos versionados siguen fuera del alcance porque los `.env` y DB permanecen en Git por decisión del propietario.

## Límites de la revisión general

- Los archivos `.env` y la base SQLite permanecen versionados porque el propietario pidió conservarlos en Git. Todo lector del repositorio y de su historial puede acceder a su contenido. Esta revisión no leyó ni mostró valores. El control de acceso del servidor no limita el acceso que concede Git.
- La contraseña que la persona ingresa sigue visible para esa misma sesión del navegador en DevTools. La medida de transporte es HTTPS; la contraseña nunca debe enviarse por HTTP desde otro equipo.
- Los tokens QR de visita son capacidades portadoras públicas para el flujo móvil y aparecen en el enlace del QR. Son permanentes por requisito operativo, distintos por IDF y no tienen expiración ni revocación; se excluyeron de respuestas a roles sin permiso de registrar y se eliminaron query strings de los logs.
- Los secretos TOTP de APIs se configuran como secreto maestro y producen un secreto estable por nombre de cuenta. Para identidad individual con alta, revocación y MFA de operador se requiere almacenamiento por persona; el login local del gateway todavía no integra MFA.
- La autorización de páginas `allowed_pages` es principalmente navegación: no sustituye permisos de datos por sede, IDF, VLAN o registro. Esos ámbitos siguen pendientes del plan de seguridad general.
- Si se configura `SGRS_PUBLIC_ORIGIN`, el proceso exige un proxy HTTPS en loopback. Para el modo LAN solicitado se usa `DASHBOARD_HOST=0.0.0.0` con `SGRS_LAN_ORIGIN` y `SGRS_LAN_CLIENT_CIDRS`; el firewall debe restringir los puertos de integración.
- No se hizo un escaneo SAST/DAST ni de dependencias. Las pruebas de API que requieren consultas a hardware se dejaron fuera porque este entorno no tendrá conexión a Forti/Omni.
