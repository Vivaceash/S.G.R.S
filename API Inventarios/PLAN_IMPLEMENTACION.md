# Plan de implementación — API Inventarios

Fecha: 2026-10-06. Estado: diseño para implementar; esta carpeta contiene el plan, no una API ejecutable todavía.

## Objetivo y alcance

Crear una tercera API independiente en `API Inventarios`, con la estructura y experiencia operativa de `API Forti` y `API Omni`: FastAPI, Pydantic, Uvicorn, configuración por entorno, autenticación, middleware, respuestas tipadas, OpenAPI, Scalar, runner, dependencias y pruebas propias.

El primer módulo completo será CCTV: inventarios actualizado e histórico, fichas, correcciones, reubicaciones, bajas administrativas, fuentes documentales, exportación y enriquecimiento con Forti/Omni. La estructura permitirá incorporar IDF/AP después, sin trasladarlos automáticamente ni ampliar esta primera entrega.

Este plan sustituye la propuesta de alojar el dominio CCTV exclusivamente en el backend del dashboard de `../PLAN_CCTV_APIS.md`. El dashboard será cliente de API Inventarios; Forti y Omni conservarán la responsabilidad de sus proveedores.

## Arquitectura acordada

```text
Navegador → backend del dashboard → API Inventarios :8002
                                      ├─ catálogo + correcciones + observaciones propias
                                      ├─ API Forti :8001 → FortiGate
                                      └─ API Omni  :8000 → OmniVista
```

- Proceso independiente, arrancable desde su carpeta sin importar los paquetes `app` de las otras APIs.
- Puerto propuesto `8002`, configurable; host local `127.0.0.1` como las APIs existentes.
- API Inventarios consume las APIs proveedoras por HTTP con credenciales propias de cliente; no necesita secretos de acceso directo a FortiGate/OmniVista.
- Las claves y los JWT de Inventarios son independientes de los de Forti/Omni. El modo 2FA de cada proveedor exige un mecanismo de autenticación de servicio verificado; no se puede asumir que cualquier API key funcione cuando 2FA está habilitado.
- El navegador mantiene llamadas al mismo origen del dashboard. Las claves de servicio quedan en backend.
- El inventario se consulta aunque los proveedores estén caídos; el enriquecimiento informa fallo, alcance parcial y antigüedad.

## Estructura propuesta

Seguir el patrón de `API Forti/app/core`, `clients`, `routers`, `schemas`, `middleware` y `security`, añadiendo servicios y repositorios para el dominio persistente:

```text
API Inventarios/
  README.md
  PLAN_IMPLEMENTACION.md
  .env.example
  requirements.txt
  requirements.lock
  run.py
  app/
    __init__.py
    main.py
    dependencies.py
    core/
      config.py
      security.py
      errors.py
    clients/
      forti.py
      omni.py
    routers/
      auth.py
      health.py
      cctv.py
      catalogs.py
      sources.py
      reconciliation.py
      history.py
    schemas/
      common.py
      cctv.py
      network.py
      sources.py
      reconciliation.py
      history.py
    services/
      inventory.py
      reconciliation.py
      network_enrichment.py
      import_service.py
      export_service.py
    repositories/
      database.py
      assets.py
      observations.py
      audit.py
    middleware/
      security.py
    security/
      logging.py
      sanitizer.py
  scripts/
    import_documentary.py
    migrate_legacy_inventory.py
  tests/
    conftest.py
    test_api_endpoints.py
    test_security.py
    test_provider_contracts.py
    test_reconciliation.py
    test_network_enrichment.py
    test_inventory_writes.py
    test_migration.py
```

Los paquetes incluirán los `__init__.py` necesarios. Los datos privados y secretos estarán fuera de los archivos versionados. Reutilizar convenciones y comportamiento probado; no copiar consultas, credenciales ni tareas de telemetría específicas de Forti/Omni.

## Paridad con las APIs existentes

- Scalar en `/docs`, alias `/scalar`; `/` y `/swagger` redirigen a Scalar. Swagger UI y ReDoc deshabilitados.
- `/openapi.json` y documentación controlados por `ENABLE_DOCS`; si se desactiva, los alias no deben servir documentación.
- Scalar muestra modelos, grupos, ejemplos, servidor de la petición y esquemas de autenticación; `persist_auth=False`.
- Prefijo de negocio `/api/v1`, etiquetas por módulo, `operation_id` estable y errores documentados.
- Respuesta común `success`, `message`, `data`; errores con código estable y request ID. Metadatos de fuente y paginación tipados.
- Autenticación por `X-API-Key` o Bearer; paridad del flujo TOTP/JWT configurable de las APIs existentes, con issuer/audience propios.
- Separar credenciales de lectura, escritura, importación y exportación: autenticar una clave no otorga automáticamente todas las operaciones.
- Contexto de petición, límites de tasa y cuerpo, cabeceras de seguridad, CORS y hosts configurados, sanitización y registros sin secretos.
- Clientes HTTP con timeout, TLS configurable con CA, concurrencia limitada y cierre en lifespan. No reintentar escrituras automáticamente.

## Datos a exponer

### Inventario y trazabilidad

Identificador estable, número/nombre, fuente actualizada/histórica, gabinete/IDF, ubicación, rack, puertos documentados, modelo, serie, MAC, IP documental, reubicación, destino, baja administrativa y notas. Para histórico: referencia de plano, alias de IP y SITE documentado cuando existan.

Conservar original documental, valores efectivos corregidos, archivo/hoja/fila/huella, origen de la dirección, observaciones de calidad, revisión del catálogo, versión del registro y fecha de corrección. Auditoría con actor y operación; al incorporar nuevas escrituras, guardar cambios de campos. La auditoría anterior puede carecer del detalle de valores, por lo que no se reconstruirá artificialmente.

### Información de red

IP/MAC/serie observadas, nombre reportado, fabricante/familia, tipo de equipo, estado reportado, última actividad, interfaz Forti, reserva/IP reservada, origen de IP, FortiGate/VDOM y fuente/fecha de consulta, cuando el proveedor lo informe. Distinguir fecha de actividad de fecha de consulta.

Añadir VLAN ID, nombre/alias, interfaz padre, subred/prefijo/máscara, dirección de interfaz y gateway documentado o configurado con su procedencia. La IP de la interfaz Forti es un candidato a gateway, no prueba de cuál está configurado en cada cámara.

El usuario identifica cámaras en `192.168.99.x`. Usar ese prefijo como pista inicial para buscar la red; resolver la máscara desde la configuración. No fijar `192.168.99.0/24` ni VLAN 99 por inferencia. La red puede contener NVR u otros equipos.

### Datos calculados e historia

Totales por gabinete/modelo/fuente, activas/retiradas/reubicadas, observadas/sin observar/ambiguas, cambios de IP, duplicados e inconsistencias. Guardar observaciones por ciclo para consultar cambios y estados desde la puesta en marcha; no fabricar historia previa.

### Capacidades posteriores

Switch/puerto/PoE requieren una asociación de terminales comprobada. Video, canales NVR, salud de grabación, almacenamiento, retención, FPS/códec y eventos requieren un adaptador CCTV/NVR verificado. El contrato inicial puede declarar capacidades no disponibles, pero no devolver valores inventados ni prometer funciones sin fuente.

## Ampliación mínima de API Forti para VLAN

El endpoint actual `/network/interfaces` consulta monitoreo y descarta VLAN ID/interfaz padre. Añadir una ruta tipada de solo lectura `/api/v1/network/interface-config`, usando el cliente Forti existente para consultar configuración de interfaces y normalizar campos permitidos: nombre, alias, tipo, VLAN ID, padre, direccionamiento principal/secundario y VDOM.

La consulta de configuración `system/interface` es una candidata a validar con la versión y permisos del FortiGate; no está implementada ni verificada en este análisis. No devolver objetos crudos de configuración. Mantener intacto el contrato actual de monitoreo y añadir pruebas de permisos, formatos y fallos.

API Inventarios combinará `/devices?view=operational`, ARP, concesiones/reservas disponibles y configuración de interfaces. Alcance por FortiGate/VDOM para evitar mezclar redes superpuestas. Asociar interfaz observada primero; si solo existe contención por subred, marcar la relación como derivada y rechazar múltiples candidatos.

La misma IP o pertenecer al segmento CCTV no identifica una cámara: vincular con MAC/serie únicas, conservar contradicciones y separar cambios de dirección. VLAN configurada describe la interfaz Forti; no confirma por sí sola el etiquetado de un puerto de acceso ni que el tráfico atraviese FortiGate.

## Contrato de endpoints propuesto

| Método y ruta | Función |
| --- | --- |
| `GET /health` | Liveness sin inventario ni secretos; funcionar con proveedores caídos |
| `GET /api/v1/system/health` | Estado de almacenamiento y dependencias, autenticado |
| Rutas `/api/v1/auth/*` | Estado/flujo 2FA y emisión de sesión según paridad con APIs existentes |
| `GET /api/v1/cctv/cameras` | Lista actualizada/histórica con búsqueda, filtros, orden y paginación |
| `GET /api/v1/cctv/cameras/{id}` | Ficha con documental, efectivo, red y procedencia |
| `PATCH /api/v1/cctv/cameras/{id}` | Correcciones permitidas con versión y auditoría |
| `GET /api/v1/cctv/summary` | Métricas con el mismo alcance de filtros |
| `GET /api/v1/cctv/export` | CSV filtrado con permiso de exportación |
| `GET /api/v1/catalogs/cabinets` | Gabinetes documentales |
| `GET /api/v1/catalogs/networks` | Redes/VLAN con origen y vigencia |
| `GET /api/v1/sources` | Metadatos de documentos sin rutas privadas |
| `GET /api/v1/sources/{sha256}/download` | Original permitido, con huella verificada |
| `POST /api/v1/reconciliation/jobs` | Crear ciclo de cotejo; `202` con identificador |
| `GET /api/v1/reconciliation/jobs/{id}` | Estado y fallos parciales del ciclo |
| `GET /api/v1/cctv/cameras/{id}/observations` | Historia de observaciones paginada |
| `GET /api/v1/cctv/cameras/{id}/changes` | Historia de correcciones autorizada |

La importación comienza como CLI, siguiendo el importador actual; no requiere un endpoint de carga de archivos en la primera entrega. No se propone crear/eliminar cámaras arbitrariamente: el alta proviene del catálogo importado y la baja es administrativa.

Filtros: dataset, gabinete, ubicación, modelo, retirada, reubicación, comparación, estado de red y VLAN. Usar límites máximos y orden permitido; exportación debe usar el mismo conjunto filtrado. Histórico no editable ni contado como cámaras actuales adicionales.

Estados independientes: inventario, identidad/cotejo y red. Ausencia ≠ offline; retirada ≠ apagada; interfaz up ≠ video disponible. En éxito parcial, declarar proveedores afectados. Usar 401/403, 404, 409, 422 y 503 según causa; no transformar errores de proveedor en listas vacías exitosas.

## Almacenamiento y transición del inventario actual

API Inventarios será propietaria de una base SQLite privada independiente, configurable por ruta absoluta, con migraciones versionadas, catálogo importado, correcciones, ciclos, observaciones y auditoría. No abrir la base del dashboard para escrituras habituales ni importar `dashboard_access` desde la nueva API.

1. Respaldar catálogo documental y base del dashboard; obtener conteos/huellas y correcciones por ID.
2. Extraer lógica de importación y reglas de inventario actualmente en `scripts/import_documentary_inventory.py` y `dashboard_inventory.py` hacia módulos propios sin cambiar semántica. Usar fixtures de caracterización.
3. Importar catálogo con IDs y procedencia preservados. Migrar correcciones y auditoría pertinente mediante herramienta CLI con modo dry-run, transacciones e informe de IDs huérfanos/conflictos.
4. Comparar originales, efectivos, versiones y bajas/reubicaciones; migración idempotente. Si cambia el formato de versión, documentar equivalencia y forzar recarga antes de aceptar escrituras.
5. Activar Inventarios primero para lectura. Antes de cambiar escrituras, bloquear temporalmente edición legacy, ejecutar sincronización final y establecer Inventarios como único escritor de CCTV.
6. Las rutas legacy de inventario conservan su contrato: separar CCTV de IDF/AP, delegar operaciones CCTV y componer lecturas cuando sea necesario. Evitar reconciliar cámaras dos veces o mezclar revisiones incompatibles.
7. Los catálogos contienen datos compartidos de gabinetes/fuentes: fijar la misma revisión documental para las lecturas compuestas y detectar discrepancias. IDF/AP siguen en su almacenamiento actual hasta una migración explícita.
8. Reimportaciones preparan una revisión nueva, muestran diferencias y solo se activan tras validación; no trasladan correcciones por IP o nombre. Separar históricos al comprobar identidad.

Rollback: antes de nuevas escrituras basta volver al lector legacy. Después de aceptar correcciones nuevas, detener escrituras y exportar/restaurar los cambios de Inventarios con comprobación de identidad/versión antes de reactivar legacy. No volver a una copia antigua perdiendo cambios.

## Integración con SGRS

- Runner raíz `run.py`: integrar arranque foreground/detached, estado, PID `api_inventarios`, logs y parada del proceso propio; incluirlo en comprobación de servicios ya activos. Comprobar conflicto del puerto sin matar servicios ajenos.
- Runner `API Inventarios/run.py`: mismo comando de ejecución y rutas Scalar que las anteriores; leer configuración propia y respetar puerto configurado desde runner raíz.
- Entorno raíz: `INVENTARIOS_API_URL=http://127.0.0.1:8002/api/v1`. Entorno del servicio: puerto/host, claves independientes, rutas privadas, URLs/claves de Forti/Omni, timeouts, docs, límites y actualización/retención.
- Prevenir colisiones entre `PORT`/`APP_API_KEY` heredados del entorno raíz y valores del servicio; documentar precedencia y usar nombres `INVENTARIOS_*` en coordinación raíz.
- `dashboard_access.py`: registrar proveedor `inventarios` y configuración en Conexiones API, sin hacerlo pasar por Forti/Omni.
- `server.py`/`dashboard_routes.py`: cliente Inventarios y rutas proxy explícitas; conservar sesión, permisos de lectura/escritura/exportación y CSRF para mutaciones originadas en navegador.
- La clave del dashboard es una identidad de servicio. No confiar en un actor arbitrario enviado por un cliente externo; la delegación del actor del dashboard solo se admite para esa identidad autenticada y queda auditada.
- `Dashboard/src/inventory.jsx`: CCTV consulta nueva API; tabla/ficha muestran documental y red/VLAN por separado, controles de actualización, filtros, exportación y fallos parciales. Mantener histórico, demo y borradores.
- `run_tests.py`: tercera suite ejecutada en proceso/cwd independiente; todas usan paquete `app`, por lo que no mezclarlas en un único proceso de pytest sin resolver colisiones.
- Revisar `pytest.ini`, instalación agregada de dependencias, README raíz, scripts de arranque y despliegue para registrar el tercer servicio.

## Fases de ejecución y condición de cierre

1. **Base independiente:** estructura, configuración, seguridad, respuestas, health y Scalar. Cierre: arranca por separado, OpenAPI válido, docs configurables y acceso protegido.
2. **Inventario completo:** repositorio, importación, consultas, fichas, correcciones, histórico, fuentes y exportación. Cierre: paridad funcional con CCTV actual y pruebas de concurrencia/permisos.
3. **Forti y VLAN:** ampliar API Forti, clientes y enriquecimiento, con fixtures de `192.168.99.x`, máscara real, VDOM y conflictos. Cierre: identidad y relación de red tienen procedencia verificable; sin asumir VLAN 99.
4. **Cotejo e historia:** jobs persistidos, caducidad, caché y observaciones. Cierre: un ciclo comparte consultas, no hay consulta por cámara, jobs interrumpidos se recuperan o marcan fallidos y caídas no borran datos.
5. **Migración y dashboard:** dry-run, comparación, corte de escritor e integración al runner/conexiones/UI. Cierre: correcciones conservadas, rutas compatibles y rollback documentado/probado.
6. **Validación operativa:** probar cobertura conectada de Forti/Omni cuando se programe, documentar cámaras identificadas y limitaciones. Cierre: cobertura real medida; no declararla solo por pruebas simuladas.

Video y control quedan como una ampliación posterior condicionada a fuentes verificadas. No bloquean la API de inventarios.

## Pruebas y aceptación final

- Contratos OpenAPI/Scalar, alias, docs desactivadas, autenticación y errores coherentes.
- Escritura sin permiso, históricos, versiones concurrentes, auditoría y exportación.
- Identidad única, IP reutilizada, duplicados, serie contradictoria y desacuerdo entre proveedores.
- VLAN ID distinto del tercer octeto, máscara distinta de /24, IP secundaria, redes superpuestas/VDOM, cámara estática sin DHCP y múltiples candidatos.
- Campos ausentes, catálogo no importado, timeout, respuesta inválida, truncamiento y proveedor caído; datos antiguos identificados como tales.
- Migración idempotente con correcciones reales simuladas, huérfanos reportados, revisión de catálogo y rollback después de escrituras.
- Pruebas de navegador CCTV móvil/escritorio, filtros/exportación, demo y ausencia de regresiones en IDF/AP.
- Suites separadas de Inventarios/Forti/Omni, pruebas raíz pertinentes y build del dashboard; prueba del runner con procesos simulados.
- No exponer claves, rutas privadas ni configuración cruda; no ejecutar órdenes a cámaras al retirar/reactivar.

Resultado final esperado: tres APIs separadas, cada una con carpeta, proceso, configuración y Scalar propios; CCTV servido por Inventarios y enriquecido mediante proveedores existentes, con información documental, administrativa y de red claramente distinguida.
