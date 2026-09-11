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
| Usuarios | Cuentas locales, creación/asignación de viewer/admin/super-admin y suspensión reversible |
| Conexiones API | URL, credencial, método de autenticación, guardado y prueba explícita desde el servidor |

Las credenciales no se persisten en el navegador. El gateway valida sesión y rol; Usuarios y Conexiones API están al pie del sidebar y requieren super-admin. La etapa local no equivale a un despliegue seguro de producción: faltan MFA/SSO, ámbitos y cifrado de secretos en reposo. Consultar los límites en la guía de usuarios.

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
