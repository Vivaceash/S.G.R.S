# SGRS · Centro Operativo

Dashboard React + Tailwind v4, compilado con Vite. Reproduce la identidad institucional de las cinco referencias proporcionadas: dashboard, altas, recursos, direcciones IP y entrada IDF, más bitácora e inventario de dispositivos.

## Desarrollo

Requiere Node.js 22 o superior y las dependencias Python del repositorio para el proxy.

```bash
cd Dashboard
npm ci
npm run dev
```

Abrir http://127.0.0.1:5173. Para revisar el diseño con datos ficticios: http://127.0.0.1:5173/?demo=1. El modo demo no llama a las APIs; las ediciones se conservan solo en memoria hasta recargar o cambiar de modo.

Para trabajar sin acceso a la red institucional, usa directamente `?demo=1`: no necesitas iniciar Python, FortiGate ni OmniVista. La integración operativa se podrá validar cuando exista acceso; no es un requisito para explorar el diseño local.

Vite envía `/api/*` a http://127.0.0.1:3000. Si el proxy usa otro puerto, ajustar `SGRS_PROXY_TARGET` al iniciar Vite. Las APIs internas se configuran en el servidor, no en el navegador.

## Compilar y servir con Python

```bash
cd Dashboard
npm ci
npm run build
cd ..
.venv/bin/python server.py
```

Abrir http://localhost:3000. `server.py` sirve exclusivamente `Dashboard/dist/`, además de las rutas API existentes. Es necesario recompilar después de editar React. Si ya hay un servidor iniciado, no ejecutar otro lanzador que cierre puertos; reiniciar únicamente el proceso del dashboard mediante el mecanismo habitual.

Para iniciar todo el sistema con `run.py`, compilar primero. Para cuentas reales, crear el primer super-admin con `.venv/bin/python dashboard_access.py bootstrap` desde la raíz y reiniciar Python. Ver [usuarios, conexiones y registro móvil](../USUARIOS_Y_CONEXIONES.md).

## Conexiones y límites

### HTTPS para acceso desde otros equipos

Usa un proxy TLS en el mismo equipo que Python. [deploy/Caddyfile.example](../deploy/Caddyfile.example) publica un dominio mediante Caddy y reenvía al gateway en loopback. Sustituye el dominio por el real y haz que resuelva a este servidor. Para certificados públicos, el dominio y los puertos 80/443 deben cumplir los requisitos de [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https). Para una red privada usa un certificado de la institución confiable para los navegadores y configura `tls /ruta/certificado.pem /ruta/clave.pem` en el bloque del sitio.

En el `.env` raíz configura `DASHBOARD_HOST=127.0.0.1`, `DASHBOARD_PORT=3000` y `SGRS_PUBLIC_ORIGIN=https://tu-dominio-real`. El puerto de destino en Caddy debe coincidir con el puerto efectivo de Python. Reinicia el gateway y ejecuta Caddy con el archivo adaptado (`caddy run --config deploy/Caddyfile.example --adapter caddyfile`). Accede únicamente al dominio HTTPS. Configurar el origen por sí solo no instala un certificado ni cifra HTTP.

El gateway acepta autenticación y datos de sesión mediante el proxy local que indica `X-Forwarded-Proto: https` y conserva el Host del dominio configurado. No confía en `Origin` como prueba de TLS. Con origen público configurado, tampoco acepta autenticación HTTP en localhost. Sin origen público, HTTP se admite exclusivamente para desarrollo desde loopback. El frontend rechaza solicitudes de cuenta, administración y sesión sobre HTTP remoto antes de enviar el cuerpo. Los tokens de sesión usan cookies `HttpOnly`, `SameSite=Strict` y `Secure` en HTTPS.

Comprueba en el navegador que el certificado sea válido y que la URL de `/api/auth/login` comience con `https://`; la respuesta no debe incluir contraseña ni hash y la cookie debe tener `Secure`. F12 seguirá mostrando el cuerpo que el propio navegador prepara. [TLS protege el tráfico en la red](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html), no lo oculta a quien controla el navegador.

El reporte móvil `/api/mobile-report` conserva la excepción HTTP para los QR existentes; no admite credenciales de cuenta. Sus datos y tokens QR no quedan cifrados si se usa HTTP: publica también sus enlaces mediante HTTPS antes de considerarlos privados.

| Pantalla | Estado |
| --- | --- |
| Dashboard | Consulta DHCP, inventario y servicios; no calcula disponibilidad histórica real |
| Recursos | Lee IDFs; crea/actualiza equipos con el contrato actual de Python |
| Direcciones IP | Consulta, asignación y liberación en inventario local; no configura DHCP |
| Dispositivos | Inventario del proxy y detalle de tráfico FortiGate |
| Registro IDF | Formulario de la plantilla en móvil; reportes e incidencias de solo consulta en escritorio |
| Bitácora | Fusiona incidentes históricos y reportes persistidos |
| Altas WiFi | Diseño y creación de ejemplos en demo; pendiente de API de solicitudes |
| Stock por unidades | Diseño/edición en demo; pendiente de modelo y API de existencias |
| Fotografías | Una imagen PNG/JPG de hasta 10 MB por reporte, descarga autenticada |
| Usuarios | Cuentas locales, altas por rol autorizado, suspensión reversible y cuentas ocultas administradas por super-admin |
| Conexiones API | URL, credencial, método de autenticación, guardado y prueba explícita desde el servidor |

Las credenciales no se persisten en el navegador. El gateway valida sesión y rol; Usuarios está disponible para admin y super-admin; Conexiones API requiere super-admin. La etapa local no equivale a un despliegue seguro de producción: faltan MFA/SSO del dashboard, ámbitos y cifrado de secretos en reposo. Consultar los límites en la guía de usuarios.

Superusuario es interno: viewer/admin solo reciben sus dos roles operativos desde el servidor. El perfil y los mensajes públicos no muestran un nivel adicional, y la demo opera como admin sin acceso a Usuarios/Conexiones ni tráfico reservado. Reiniciar el gateway y recargar el build para aplicar el contrato `roles` de sesión; no se migran cuentas. El detalle de cobertura de APIs y las páginas futuras están en [el informe técnico](../ANALISIS_APIS_Y_EVOLUCION_DASHBOARD.md).

## Verificación

```bash
npm test
npm run build
npm run test:browser
```

La prueba de navegador requiere el servidor Vite activo y usa Brave/Chromium. Configurar `SGRS_BROWSER` para la ruta del binario y `SGRS_TEST_URL` para el origen. Las llamadas API se interceptan con fixtures; nunca modifica los archivos JSON operativos. Genera capturas y `artifacts/browser-report.json`.

La ampliación de usuarios/conexiones/IDF no ejecuta pruebas por indicación del usuario. Las evidencias guardadas de la primera entrega no acreditan estas funciones.

Contratos: [DESIGN.md](../DESIGN.md), [UX-CONTRACT.md](../UX-CONTRACT.md). Código anterior: `legacy.html`, `app.js`, `styles.css` y `views/`, conservado como referencia y excluido del build público. `qrcode.js` se reutiliza en React.
