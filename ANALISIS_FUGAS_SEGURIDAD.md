# Revisión de exposición de credenciales

Revisión estática del dashboard, gateway Python, APIs Forti y OmniVista, clientes, configuración y suites locales. No se consultaron los equipos de red. La revisión de transporte del 2026-10-06 incluye pruebas locales y de navegador con fixtures; no acredita un despliegue TLS en producción.

## Comportamiento de F12 durante el acceso

El navegador que inicia sesión puede inspeccionar el cuerpo de su propia petición y ver la contraseña que acaba de enviar. Eso es normal en un acceso con usuario y contraseña: el cliente necesita entregarla al servidor. HTTPS protege el trayecto de red, no oculta la petición al navegador de quien la hizo. Cifrar o aplicar un hash en JavaScript no resuelve este límite.

La respuesta de inicio de sesión no contiene la contraseña ni su hash. El servidor conserva un hash scrypt con sal y entrega la sesión en una cookie `HttpOnly`, `SameSite=Strict`; la cookie no se guarda en `localStorage`. Las respuestas de la API no deben repetir la contraseña. La cuenta inicial se crea por consola salvo habilitación local explícita.

## Cambios realizados en esta revisión

- Las listas de usuarios ahora se autorizan y filtran en el servidor. El superadministrador aparece como administrador normal para administradores operativos; no recibe páginas internas ni indicadores de ocultamiento. Las cuentas ocultas no se enumeran y una modificación directa de su ID obtiene una respuesta indistinguible de una cuenta inexistente. Solo el superadministrador puede ocultar o restaurar cuentas.
- Las referencias a cuentas ocultas se minimizan en respuestas operativas y se retira el token QR de visita de las respuestas que no tienen capacidad para registrar visitas.
- Las credenciales y campos equivalentes se enmascaran en objetos JSON recibidos de Forti/Omni. El proxy evita reenviar cuerpos de error de los equipos. Se limitaron errores que devolvían mensajes internos y se dejaron de imprimir tokens o respuestas de autenticación en utilidades.
- El diagnóstico Forti, los pools DHCP y los endpoints de salud de sistema Omni ahora requieren la clave de servicio. Se conservan endpoints mínimos de liveness que no consultan la red.
- Se exige HTTPS para credenciales desde otros equipos, la cookie se marca `Secure` con origen HTTPS, se desactiva el guardado de autorización en Scalar y se endurecen CSP y `Referrer-Policy` del dashboard. El gateway vuelve a enlazarse a loopback por defecto y rechaza un enlace externo sin origen HTTPS configurado.
- Los clientes Forti/Omni verifican certificados TLS por defecto. Activar 2FA requiere un secreto TOTP dedicado; los códigos se derivan por nombre de cuenta desde ese secreto, nunca desde la clave de API.
- Las respuestas dejan de almacenar en caché API. El servidor limita archivos servidos a la carpeta compilada, rechaza symlinks que escapan de ella, bloquea métodos de lectura alternativos en la API y excluye query strings de los logs HTTP.

## Revisión de transporte (2026-10-06)

La validación anterior de login y administración aceptaba `Origin` con esquema HTTPS como prueba de cifrado. Esa cabecera es controlada por el cliente y podía acompañar una petición HTTP; además, las consultas autenticadas no tenían la misma restricción. Se sustituyó por una frontera para todas las rutas de cuenta y sesión: el origen público debe coincidir con Host y el proxy local debe indicar `X-Forwarded-Proto: https`. Solo se confía en conexiones desde loopback y el lanzador rechaza enlazar el gateway fuera de loopback cuando se configura un origen público.

Sin origen público, HTTP solo admite cuentas desde loopback, para desarrollo. El frontend aplica la comprobación antes de enviar solicitudes de sesión, bootstrap, usuarios y conexiones. `/api/mobile-report` conserva su excepción LAN: sus tokens y datos requieren enlaces HTTPS para cifrarse. [El Caddyfile](deploy/Caddyfile.example) y [las instrucciones](Dashboard/README.md#https-para-acceso-desde-otros-equipos) permiten configurar un proxy real; definir una variable HTTPS no activa TLS. No se instaló Caddy ni se provisionó un certificado o dominio en esta revisión.

Se añadieron pruebas de rechazo HTTP antes de leer credenciales, rechazo de `Origin` y cabeceras reenviadas falsificadas desde la red, aceptación del proxy local, cookie Secure, desarrollo local y bloqueo del fetch inseguro. Se confirmó por nombres de archivos, sin leer valores, que Git incluye `.env`, los `.env` de APIs y `.sgrs-private/dashboard.sqlite3`. Este riesgo persiste en las copias y el historial; retirar los archivos actuales no revoca secretos ya expuestos. Las credenciales reales que hayan salido del entorno confiable deben rotarse.

Por instrucción del propietario se conservan los `.env` y la base en Git. Esta revisión no cambia sus valores ni elimina archivos o historial.

Validación: 72 pruebas Python aprobadas (`test_dashboard_transport`, `test_dashboard_access`, `test_run_environment`), pruebas de dominio y transporte JavaScript aprobadas y build Vite correcto. La suite completa `npm test` termina con 34 aprobadas y una falla ajena al transporte: `segments.test.mjs:28` espera `roleLabel('admin') === 'admin'`, mientras la interfaz devuelve `Administrador`. Las pruebas de navegador de dispositivos y soporte pasan fuera del sandbox, con APIs interceptadas.

## Límites de la revisión general

- Los archivos `.env` y la base SQLite permanecen versionados porque el propietario pidió conservarlos en Git. Todo lector del repositorio y de su historial puede acceder a su contenido. Esta revisión no leyó ni mostró valores. El control de acceso del servidor no limita el acceso que concede Git.
- La contraseña que la persona ingresa sigue visible para esa misma sesión del navegador en DevTools. La medida de transporte es HTTPS; la contraseña nunca debe enviarse por HTTP desde otro equipo.
- Los tokens QR de visita son capacidades portadoras públicas para el flujo móvil y aparecen en el enlace del QR. Se excluyeron de respuestas a roles sin permiso de registrar, y se eliminaron query strings de los logs. Falta fijar vencimiento, revocación y límites de uso por QR antes de tratarlo como enlace privado.
- Los secretos TOTP de APIs se configuran como secreto maestro y producen un secreto estable por nombre de cuenta. Para identidad individual con alta, revocación y MFA de operador se requiere almacenamiento por persona; el login local del gateway todavía no integra MFA.
- La autorización de páginas `allowed_pages` es principalmente navegación: no sustituye permisos de datos por sede, IDF, VLAN o registro. Esos ámbitos siguen pendientes del plan de seguridad general.
- Si `.env` contiene un `DASHBOARD_HOST` público, el proceso ahora exige `SGRS_PUBLIC_ORIGIN` HTTPS. El proxy, el firewall y los procesos upstream aún deben restringirse a la red necesaria.
- No se hizo un escaneo SAST/DAST ni de dependencias. Las pruebas de API que requieren consultas a hardware se dejaron fuera porque este entorno no tendrá conexión a Forti/Omni.
