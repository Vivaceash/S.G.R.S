# Plan de implementación de seguridad — S.G.R.S.

Estado actualizado: 2026-08-31

> Documento histórico. Para la implementación local actual, consultar [USUARIOS_Y_CONEXIONES.md](USUARIOS_Y_CONEXIONES.md), y para el roadmap institucional [PLAN_USUARIOS_PRIVILEGIOS.md](PLAN_USUARIOS_PRIVILEGIOS.md). El gateway ahora valida sesiones/roles y escucha en loopback por defecto. Las garantías históricas descritas abajo no equivalen a una auditoría del gateway nuevo.

## Decisión vigente para desarrollo

- La clave `admin` se conserva de forma intencional únicamente para desarrollo local.
- El dashboard solo la precarga en compilaciones de desarrollo y nunca la persiste en `localStorage`.
- Ambos backends rechazan `admin` al iniciar fuera de `development` o `test`.
- Los servicios y Vite escuchan por defecto en `127.0.0.1`.

## Implementado

### Fase 1 — Configuración segura y arranque fail-closed

- Validación estricta de entorno para claves débiles, depuración, bypass de autenticación,
  secretos JWT de ejemplo, hosts/CORS comodín, enrolamiento 2FA y TLS del upstream.
- Validación de HTTPS y del archivo CA en producción.
- Ejemplos de entorno separados de los requisitos de producción.

### Fase 2 — Autenticación y sesiones

- JWT con emisor y audiencia diferentes por servicio, `jti`, expiración, `nbf`, `iat` y
  verificación estricta de algoritmo, tipos y duración.
- Los JWT solo autentican cuando 2FA está habilitado.
- Sesiones reducidas a una hora.
- Enrolamiento 2FA cerrado por defecto y limitado explícitamente al desarrollo.
- Rate limit independiente para rutas de autenticación.

### Fase 3 — Frontera HTTP

- Cabeceras reenviadas aceptadas únicamente desde proxies IP/CIDR configurados.
- Límite real del cuerpo ASGI, incluso sin `Content-Length`.
- Identificadores de petición validados para evitar inyección en logs.
- CORS con cabeceras explícitas, sin credenciales, y cabeceras de seguridad/no-cache.

### Fase 4 — Minimización de datos

- Eliminadas respuestas crudas de FortiOS.
- Sanitización recursiva de respuestas OmniVista y mensajes de error upstream.
- Logs limpiados de caracteres de control y valores excesivamente largos.

### Fase 5 — Dashboard

- Clave API solo en memoria; URLs validadas y HTTPS obligatorio fuera de localhost.
- Prevención de inyección de fórmulas en CSV.
- Modal accesible con foco contenido/restaurado, Escape, labels y errores persistentes.
- Vite limitado a loopback y preview con política CSP.

### Fase 6 — Cadena de suministro y verificación

- Lockfiles Python con hashes para ambos servicios.
- `npm audit` y `pip-audit` sin vulnerabilidades conocidas.
- Suites backend, lint, build, auditoría UI estricta e inspección visual completadas.

## Pendiente antes de producción

Estas tareas necesitan decisiones de arquitectura o infraestructura y no deben resolverse
con supuestos dentro del código actual:

1. Sustituir la clave compartida por identidad individual (OIDC/SSO) y RBAC con roles de
   lectura, operación y administración.
2. Sustituir el TOTP determinista/compartido por factores por usuario almacenados cifrados,
   con recuperación, revocación y códigos de respaldo; alternativamente delegarlo al IdP.
3. Mover la autenticación del navegador a un BFF con cookie `HttpOnly`, `Secure` y
   `SameSite`, de modo que ningún secreto de API llegue al frontend.
4. Usar un gestor de secretos, claves distintas por servicio y rotación documentada.
5. Instalar certificados de confianza para FortiOS/OmniVista y terminar TLS en un proxy
   configurado en `TRUSTED_PROXY_IPS`.
6. Si habrá más de una instancia, reemplazar el rate limit en memoria por Redis u otro
   almacén compartido.
7. Incorporar SAST, auditoría de dependencias y escaneo de secretos como gates de CI.

## Gate de liberación

No cambiar `ENVIRONMENT` a `production` hasta completar, como mínimo, los puntos 1–5 y
probar la configuración final en un entorno de staging representativo.
