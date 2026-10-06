# Plan de integración de CCTV con las APIs

Fecha: 2026-10-06. Alcance: análisis del código y propuesta; no se modificó la aplicación ni se consultaron dispositivos reales.

Actualización de arquitectura: por solicitud del usuario, el plan vigente crea una tercera API independiente en `API Inventarios`. Ver [plan de implementación](API%20Inventarios/PLAN_IMPLEMENTACION.md). La propuesta original de ubicación en el backend del dashboard queda sustituida; su diagnóstico del estado actual sigue siendo referencia.

## Dictamen

Es viable integrar todo el apartado actual de CCTV —inventario actualizado e histórico, fichas, filtros, exportación, correcciones, reubicaciones y bajas administrativas— con una superficie API coherente. Gran parte ya existe en la API del dashboard.

También es viable agregar observaciones de red usando los adaptadores existentes de FortiGate y OmniVista. La cobertura real de cámaras todavía debe comprobarse: el repositorio no demuestra que esos proveedores entreguen todas las cámaras. Video, grabación, canales NVR, PTZ y acciones sobre cámaras requieren una integración adicional y comprobación de capacidades; no se pueden prometer con los contratos actuales.

Se interpreta «agregar CCTV a las APIs» como conectar el módulo completo a datos y operaciones API. Si se necesita consumirlo desde aplicaciones externas, hará falta además un contrato de autenticación para clientes de servicio: hoy la API del dashboard utiliza sesión.

## Evidencia del estado actual

| Función | Implementación actual | Brecha |
| --- | --- | --- |
| Consulta de cámaras | `GET /api/inventory/catalog`, en `dashboard_routes.py`; incluye `cctv` y `cctv_original` | Devuelve el catálogo general; no tiene consulta dedicada, paginación ni filtros de CCTV en servidor |
| Correcciones, reubicaciones y bajas | `POST /api/inventory/asset`; `dashboard_inventory.save_asset` | Ya usa permisos, CSRF, auditoría y versión; la baja es una anotación local, no una orden al equipo |
| Cotejo de identidad y red | `GET /api/inventory/reconcile`; `dashboard_inventory.live_reconciliation` | Ya incluye `cctv`, excluye históricos y racks; no hay un contrato específico de cámaras |
| Fuentes del cotejo | Forti: `/devices?view=operational`; Omni: `/monitoring/devices` | Debe comprobarse visibilidad de las cámaras; inventario de infraestructura no garantiza inventario de terminales CCTV |
| Pantalla CCTV | `Dashboard/src/inventory.jsx` | La rama CCTV oculta el botón de cotejo y las columnas de IP observada, estado API y comparación |
| Documentos y exportación | Descarga de originales por huella en backend; CSV generado en navegador | Mantener autorización y precisar si se necesita exportación API para clientes externos |
| Video y grabación | No se encontró un adaptador CCTV/NVR en el código revisado | Requiere descubrir proveedor, modelos, versiones, protocolos y permisos disponibles |

El cotejo ya evita vincular por IP o nombre solamente, rechaza identidades ambiguas y conserva la IP documental. Las pruebas en `tests/test_documentary_inventory.py` cubren cámaras, fuentes caídas, conflictos y permisos.

Los documentos del proyecto reportan 150 cámaras actualizadas y 149 históricas. Son dos fuentes, no 299 equipos únicos. El resumen de estructura documenta 155 frente a 150 del catálogo actualizado; esa diferencia debe conciliarse y no representa por sí sola cámaras físicamente faltantes. Estos conteos proceden de documentación existente, no de un censo en vivo realizado en este análisis.

## Arquitectura propuesta

Mantener Forti y Omni como adaptadores de sus respectivos proveedores. El backend del dashboard compone el dominio CCTV, reutilizando catálogo, correcciones y reconciliación. No duplicar el catálogo y las reglas de negocio en ambas APIs proveedoras.

Separar tres dimensiones en cada ficha:

- Inventario: activa o retirada; reubicación y destino documentado.
- Red: observación del proveedor, IP actual, fecha, fuente y resultado de identidad.
- Video/grabación: sin verificar inicialmente; completar únicamente con evidencia de un adaptador CCTV compatible.

La ausencia en una consulta no equivale a desconexión. Una cámara retirada puede seguir observándose en red. El estado de un switch no acredita el estado de sus cámaras. `observed_at` actual indica cuándo se consultó el proveedor; no es la última actividad de la cámara. Debe conservarse esa distinción al añadir `last_seen` y caducidad.

## Fases y entregables

### 1. Confirmar contratos y cobertura

- Inventariar campos y operaciones de la pantalla actual y fijar el contrato de cámaras actualizado/histórico.
- Revisar muestras controladas de respuestas Forti/Omni: identidad, IP, estado, última actividad, alcance y posible truncamiento o paginación.
- Elaborar una matriz por cámara: identificable, ambigua, sin identidad suficiente o sin observación. No asumir clasificación por VLAN, fabricante o nombre como identidad.
- Identificar, para una etapa posterior, NVR/VMS, modelos y firmware, documentación del fabricante y permisos de solo lectura disponibles.

Entrega: contrato de datos y matriz de capacidades verificadas. El desarrollo puede avanzar con fixtures; una prueba conectada queda como validación operativa pendiente hasta que se programe.

### 2. Completar la integración actual con el mínimo cambio

- Habilitar «Cotejar APIs» y actualización de catálogo en CCTV actualizado usando los endpoints existentes.
- Mostrar IP documental e IP observada, estado de red, fuente, fecha y comparación en tabla/ficha.
- Agregar filtros y métricas separados para inventario y red; incluirlos en el CSV.
- Mantener el histórico de solo lectura y sin estados actuales inferidos.
- Preservar filtros, borradores, control de versión y comportamiento de IDF/AP del componente compartido.

Entrega: CCTV integrado con el cotejo actual, sin necesidad de modificar las APIs proveedoras si sus respuestas bastan.

### 3. Consolidar una API CCTV dedicada

Rutas propuestas, todavía no implementadas:

| Ruta | Propósito |
| --- | --- |
| `GET /api/cctv/cameras` | Lista con fuente actualizada/histórica, búsqueda, filtros, orden y paginación |
| `GET /api/cctv/cameras/{id}` | Ficha documental, corrección efectiva y última observación disponible |
| `GET /api/cctv/summary` | Métricas separadas de inventario, cotejo y red; mismo alcance de filtros |
| `POST /api/cctv/reconcile` | Ejecutar actualización del cotejo y devolver el resultado o identificador del trabajo |
| `POST /api/cctv/cameras/{id}/corrections` | Guardar campos permitidos reutilizando `save_asset`, con versión y auditoría |
| `GET /api/cctv/export` | CSV del alcance filtrado, si se necesita exportación desde backend |

Usar POST para una actualización que persiste observaciones; GET consulta la última disponible. Conservar las rutas de inventario existentes para IDF/AP y compatibilidad. No crear un almacenamiento paralelo de correcciones.

Definir respuestas estables: `id`, `dataset`, datos documentales, datos efectivos, `version`, estado de inventario, cotejo, observaciones por proveedor, antigüedad y salud de fuentes. Diferenciar catálogo no importado, recurso inexistente, conflicto de versión, proveedor caído y resultado parcial.

Reutilizar sesión y permisos actuales; comprobar lectura, escritura y exportación en cada ruta. Documentar contratos con ejemplos y errores. Para consumidores externos, añadir autenticación específica de servicio con alcance de lectura/escritura explícito, sin reutilizar claves de proveedores en el navegador.

### 4. Actualización operativa e historial

- Consultar proveedores una vez por ciclo y compartir el resultado entre usuarios; evitar una consulta por cámara.
- Establecer tiempo máximo, caché, actualización manual y caducidad configurables según la capacidad medida de proveedores.
- Conservar el último resultado válido con fecha y marcarlo como antiguo ante fallos; no presentarlo como estado actual.
- Si se requiere historial, añadir almacenamiento de observaciones separado de `inventory_edits`, con retención e índices por cámara/fecha.
- Diferenciar timestamp de consulta y timestamp de actividad reportado; los contratos actuales normalizan estado, pero no conservan `last_seen` en el cotejo.
- Revisar la correspondencia de IDs después de reimportaciones antes de asociar historia o correcciones; no trasladar datos automáticamente entre identidades ambiguas.

Entrega: monitoreo estable y trazable. Las alertas de caída requieren definir evidencia suficiente, caducidad y confirmación en varios ciclos antes de activarlas.

### 5. Integración directa de CCTV, condicionada a capacidades

- Construir un adaptador NVR/VMS o de cámaras después de verificar su API o protocolos admitidos.
- Incorporar canales, salud de grabación y video únicamente cuando la fuente los reporte y pueda asociarlos a una identidad confiable.
- Para switch/puerto/PoE, verificar un contrato que entregue asociaciones de terminales; la topología existente no basta como prueba de esa capacidad.
- Tratar vista de video, reproducción y control como entregables separados con transporte, permisos y pruebas propios.
- Mantener credenciales en backend y limitar conexiones a destinos configurados. Las bajas administrativas siguen siendo locales; apagado, reinicio o PTZ serían operaciones nuevas.

Entrega: capacidades CCTV verificadas. Esta fase no bloquea inventario y cotejo de red.

## Validación y criterios de aceptación

1. Todas las funciones actuales siguen disponibles mediante API, conservando originales, correcciones y permisos.
2. Coincidencia por MAC/serie única; IP compartida, duplicados y contradicciones no generan asociaciones silenciosas.
3. Fuente caída, respuesta parcial, dato caducado, no observado y desconexión reportada se distinguen.
4. Cambios concurrentes devuelven conflicto y conservan el borrador; el histórico rechaza escrituras.
5. Retirar/reactivar modifica inventario, no ejecuta comandos sobre cámaras ni sobrescribe estado de red.
6. Filtros, métricas y exportación tienen un alcance consistente y declaran fecha de observaciones.
7. Nuevas rutas rechazan solicitudes sin sesión, escritura sin permisos/CSRF y exportación no autorizada.
8. Pruebas de backend con fixtures cubren contratos y fallos; prueba de navegador cubre CCTV, móvil, filtros, exportación y ausencia de regresiones en IDF/AP.
9. Antes de declarar cobertura real, una validación conectada documenta cuántas cámaras pueden identificarse por fuente y sus limitaciones.

Reutilizar `tests/test_documentary_inventory.py`, las pruebas de acceso y `Dashboard/tests/inventory-browser.mjs`; extenderlas según las fases. Ejecutar pruebas relevantes, compilación del dashboard y comprobación del diff. Este análisis no ejecutó suites ni validación conectada.

## Orden recomendado

Implementar primero fases 1–2: resuelven la brecha visible aprovechando el backend existente. Después consolidar fases 3–4 si se necesita una API CCTV consumible y monitoreo continuo. Estimar la fase 5 tras conocer equipos y contratos; actualmente no hay evidencia suficiente para fijar su alcance ni duración.

Puntos pendientes: cobertura real de Forti/Omni, necesidad de clientes externos, frecuencia y retención del monitoreo, y si «todo CCTV» incluye video/grabación/control además del apartado actual.
