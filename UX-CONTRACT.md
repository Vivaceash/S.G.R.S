# Contratos de interacción · SGRS

## Consultas e históricos · actualización del 11 de septiembre de 2026

Fuente de negocio: autorización actual del usuario para implementar y probar con las APIs disponibles; retención elegida expresamente de métricas agregadas por 30 días. Esta autorización reemplaza la prohibición de pruebas de la etapa anterior documentada al final.

`dashboard_catalog.py` es el propietario del catálogo técnico; `telemetry.jsx` reutiliza Select nativo (popup del sistema aceptado), DataTable, SearchField, Notice, PageHeading y Dialog. La navegación y los recursos seleccionados se restauran por hash; las búsquedas personales permanecen en memoria. Las tablas paginan, buscan y exportan únicamente el bloque recibido, declarado explícitamente. Cada fuente se carga por selección, no se consultan todos los equipos al abrir el menú. Reintentar no escribe en los equipos; cambios de selección cancelan solicitudes y descartan respuestas obsoletas.

Histórico: `dashboard_history.py`, muestras de cinco minutos, retención de 30 días, borrado automático y lista cerrada de seis métricas numéricas. Valores ausentes son “No informado”, no cero; timestamps conservan UTC explícito. No hay almacenamiento histórico de datos personales ni de tráfico individual.

Verificación adicional: `node tests/telemetry-browser.mjs` dentro de Dashboard cubre rutas, detalles, 403, errores/reintentos, búsqueda, móvil y axe. `scripts/check_dashboard_live.py` comprueba el gateway con datos reales y cuentas temporales; nunca escribe configuración en los equipos. Las rutas upstream sin JSON se muestran como no disponibles, no como estado saludable ni inventario vacío.

La interfaz vigente está en `Dashboard/src`. `DESIGN.md` define la intención visual; los archivos legacy no son implementaciones alternativas permitidas. Idioma `es-MX`, zona horaria `America/Mexico_City`. La autorización local se describe en `USUARIOS_Y_CONEXIONES.md`; el alcance institucional futuro continúa en `PLAN_USUARIOS_PRIVILEGIOS.md`.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Select y controles nativos | Dashboard/src/components.jsx | Select nativo etiquetado, requerido, inválido o deshabilitado; sin listbox artesanal | Dashboard/tests/browser.mjs: filtros y validación IDF |
| Date | Texto de servidor y formateador compartido | Dashboard/src/domain.mjs | Fecha de registro asignada al guardar; sin selector de fecha editable | Dashboard/tests/domain.test.mjs y revisión de EntryForm |
| Form | Field, SecretInput y useForm | Dashboard/src/forms.jsx y Dashboard/src/components.jsx | Visita, usuarios, conexiones e ingreso; confirmación de permisos/destino; valores secretos enmascarados | Dashboard/tests/browser.mjs; ampliación pendiente de ejecución |
| Scrollbar | Tema global y scroll del documento | Dashboard/src/styles.css | Contenedor horizontal de tabla; diálogo con scroll interno; sin skins opt-in | Dashboard/tests/browser.mjs: reflow móvil y capturas |
| Toast | Notice y estado toast en App | Dashboard/src/App.jsx | Éxito, información y error con texto; región anunciada; no es la única prueba del guardado | Dashboard/tests/browser.mjs: éxito confirmado |
| CRUD | App, DataTable, EntryForm y EditForm | Dashboard/src/App.jsx | Lectura, creación de visita, edición IP/recurso y liberación confirmada; no existe borrado arbitrario | Dashboard/tests/browser.mjs: flujo de visita y edición de IP |

## Navegación y persistencia

- Hash routes compatibles con enlaces anteriores; cada pantalla tiene un encabezado único y recibe el foco tras navegar.
- Estado de filtros, orden y página en URL; búsqueda libre en memoria para no exponer datos personales en historial. No hay localStorage para credenciales, borradores ni identidad.
- La navegación interna, cambio de modo y cierre de formulario protegen cambios sin guardar; `beforeunload` solicita la protección disponible en el navegador. Esta protección no garantiza recuperar datos después de un cierre forzado.
- Sidebar persistente en escritorio y diálogo modal en móvil. Escape cierra diálogos; el foco regresa al disparador. La navegación móvil se cierra tras elegir destino.

## Listados

- Búsqueda con etiqueta y botón de limpieza; respeta composición IME. Cambiar filtros reinicia la página; el paginado se limita al total filtrado.
- Orden accesible con `aria-sort`; cabeceras, estado vacío y recuentos compartidos. No hay selección múltiple ni operaciones masivas.
- Exportación CSV solo de datos cargados/filtrados, con escape de comillas y mitigación de fórmulas. No equivale a un export global autorizado.
- Tablas conservan el contexto comparativo mediante scroll horizontal en móvil; la página no debe desbordarse. No ocultar acciones necesarias para encajar columnas.

## Formularios y mutaciones

- Etiquetas visibles, mensajes asociados y `aria-invalid`; al enviar inválido, enfocar el primer campo incorrecto.
- Mantener valores ante 401/403/409/422/429/5xx o fallo de red. Bloquear doble envío y acciones incompatibles mientras se guarda. No reintentar automáticamente mutaciones.
- El éxito aparece después de una respuesta satisfactoria y actualiza el listado. Una interrupción de red puede dejar resultado incierto: comprobar el registro antes de repetir. Las visitas nuevas deduplican el identificador de solicitud; otras mutaciones no admiten reintento automático.
- Liberar IP requiere confirmación explícita; la bitácora no permite eliminar registros. Se admite una evidencia PNG/JPG de hasta 10 MB por visita, con selección y eliminación antes del guardado, mensajes de preparación/error y descarga autenticada posterior.
- El modo demostración solo modifica memoria, está claramente etiquetado y nunca consulta ni escribe APIs. Recargar descarta sus cambios.

## Carga, fallos y seguridad

- Cargas iniciales visibles, respuestas parciales identificadas y acción de recarga. No reemplazar fallos del sistema con datos inventados.
- Cancelación/identificador de generación impiden que respuestas antiguas sobrescriban una carga nueva; iniciar una mutación invalida refrescos pendientes.
- Todos los datos externos se renderizan como texto React. Los códigos QR codifican enlaces locales sin tokens ni credenciales.
- El frontend no es un límite de seguridad. El gateway comprueba sesión y rol; sus microservicios siguen usando credenciales de integración y no deben quedar expuestos directamente a usuarios finales.

## Accesibilidad y verificación

- Controles nativos, landmarks, enlace de salto, foco visible, texto junto a colores y tamaños táctiles. Respetar movimiento reducido y colores forzados.
- Automatización: `npm --prefix Dashboard test`, `npm --prefix Dashboard run build` y `npm --prefix Dashboard run test:browser` con Vite local activo. Playwright intercepta todas las APIs: no modifica datos operativos.
- Evidencias: `Dashboard/artifacts/browser-report.json` y capturas de escritorio/móvil. Axe cubre cinco pantallas; no reemplaza pruebas manuales con lector de pantalla, auditoría de seguridad ni integración con equipos reales.
- Limitaciones pendientes: SSO/MFA y ámbitos por recurso, pruebas con tecnologías de asistencia reales, verificación operativa contra FortiGate/OmniVista y asset oficial optimizado. El diseño se debe volver a comprobar al incorporar esos contratos.

## Cuentas y configuración: ampliación local

Fuente de negocio: petición del usuario y `USUARIOS_Y_CONEXIONES.md`. La decisión de usar cuentas locales responde al entorno sin acceso externo; no sustituye el roadmap institucional de identidad federada.

- Usuarios y Conexiones API aparecen al final del sidebar únicamente para super-admin. El acceso directo sin permiso presenta 403; no se confunde con 404 ni se concede un rol desde la URL.
- Crear/editar usuario usa el Dialog compartido. Incluye revisión explícita del rol/estado y confirmación; después de confirmar el servidor se actualiza el listado, se cierra el diálogo y se notifica. Cerrar con cambios pide descartarlos. No hay borrado definitivo.
- Las contraseñas de usuario y las credenciales de conexión usan SecretInput; no se muestran valores almacenados. El navegador no mantiene secretos en localStorage, URLs, logs ni toasts. Las credenciales API recuperables tienen protección de archivo en el servidor, no cifrado en reposo.
- Cada panel de conexión conserva su propio borrador. Guardar uno no descarta el otro; se protege la navegación mientras exista algún cambio. Cambio de versión remoto produce 409 y exige recargar la configuración.
- Probar conexión es una acción explícita independiente del guardado, con spinner, resultado persistente, HTTP y latencia. No guarda datos ni sigue redirecciones. En demo se explica que no se efectuó la consulta; nunca se declara una conexión simulada como exitosa.
- Iniciar sesión distingue credenciales inválidas, servidor inaccesible y bootstrap pendiente. Las sesiones expiran/revocan en servidor; un 401 oculta el contenido hasta reautenticar. Cambiar de cuenta, rol o versión desmonta el contenido anterior para evitar mezclar datos. Formularios modales con secretos se cierran al expirar la sesión.
- Los títulos de las rutas administrativas se actualizan en `document.title`. Los campos de búsqueda personales permanecen solo en memoria.

### Catálogo visible de privilegios

Decisión expresa: Administrador es el mayor nivel operativo visible; Superusuario permanece interno (ver `USUARIOS_Y_CONEXIONES.md`, Jerarquía visible e interna). El propietario canónico del catálogo es `dashboard_access.visible_roles`; SessionProvider recibe `roles` y Perfil/Usuarios lo reutilizan. No hay un catálogo completo embebido en el frontend. Ante un backend anterior sin catálogo, se muestra una lista vacía, nunca se inventan permisos.

Las rutas no autorizadas siguen mostrando 403 genérico y regreso al dashboard, sin nombrar otro rol. El detalle de dispositivos omite tráfico cuando falta permiso. La demo pública replica admin, no incluye Usuarios/Conexiones ni consultas técnicas. El backend conserva el bloqueo independientemente de cambios locales en React. No se representa el acceso interno como sudo del sistema operativo ni se añaden permisos al administrador.

La evidencia histórica de demo administrativa deja de aplicar. Se actualizan los casos de navegador y de autorización para la nueva visibilidad, pero su ejecución permanece pendiente por indicación del usuario. La compilación y auditoría estática no reemplazan esa validación.

## Registro IDF por dispositivo

Decisión explícita del usuario: la ruta IDF muestra un formulario hasta 850 px y únicamente reportes/incidencias por encima. El catálogo sigue existiendo como selector y fuente de inventario, pero se elimina su pantalla de listado.

El formulario y la tabla tienen propietarios de scroll independientes (documento / superficie tabular). Un cambio de ancho oculta el formulario sin descartar su borrador. Cada vista tiene un ID de encabezado distinto. Fecha e identidad definitivas pertenecen al servidor; el control de fecha es informativo, no un calendario editable. Tras registrar en móvil se abre la bitácora con opción de otra entrada; escritorio usa Actualizar reportes para recuperar los nuevos registros.

## Evidencia de esta ampliación

Por indicación del usuario no se ejecutan pruebas de navegador, APIs ni equipos en esta etapa. Solo compilación y revisión estática/sintáctica. Las capturas y resultados previos corresponden al diseño anterior; no prueban usuarios, conexiones, autorización ni el nuevo comportamiento responsive. La validación funcional y de seguridad sigue pendiente antes de producción.
