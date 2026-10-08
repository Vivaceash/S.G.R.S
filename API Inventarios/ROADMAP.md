# API Inventarios — Recomendaciones y documentación operativa

Estado documentado: 2026-10-08.

## Estado actual

- Servicio FastAPI independiente en `8002`.
- SQLite privada: catálogo, correcciones, auditoría, jobs y observaciones.
- Fuentes analizadas: `Actualización CCTV.xlsx`, `CheckList CCTV.xlsx`, `CheckList completo IDFs.docx`, `Formato_de_AP[1].docx` y `Estructura.xlsm`.
- Catálogo API: 150 activos actuales, 149 históricos, 72 observaciones documentales, 14 gabinetes y estructura de redes, conteos CCTV y enlaces de puertos.
- Dashboard activo como cliente de Inventarios para catálogo y cotejo.
- Cotejo real validado: cinco consultas proveedoras respondieron `HTTP 200`; 150 activos quedaron `not_observed` y 3,377 registros quedaron `only_api`.

La última cifra indica falta de identidad documental confirmada. No significa que las cámaras estén apagadas.

## Arquitectura objetivo

```text
Fuentes documentales
        │ importación versionada
        ▼
BD Inventarios ── API Inventarios ── Dashboard
        │                 │
        │                 ├── Adaptador FortiGate
        │                 └── Adaptador OmniVista
        │
        └── historial, auditoría, procedencia y revisiones
```

Regla: archivos son evidencia; BD es operación; API es acceso; Dashboard es consumidor.

## Prioridad P0 — corregir antes de producción

- [ ] Resolver identidad documental: normalizar MAC/serie, aliases, duplicados y campos específicos de cada proveedor.
- [ ] Crear `match_reason`, `match_confidence`, identidad usada y contradicciones por resultado.
- [ ] Crear bandeja de revisión manual para `ambiguous`, `not_observed` y `only_api`.
- [ ] Registrar correspondencias confirmadas con actor, fecha, fuente y revisión documental.
- [ ] Mantener estados separados: inventario, identidad, red y video.
- [ ] Activar configuración productiva: claves robustas, hosts/orígenes explícitos, TLS, 2FA y documentación restringida.
- [ ] Rotar secretos sin imprimirlos ni persistirlos en catálogos, logs o respuestas.
- [ ] Definir backup, restauración probada y retención de observaciones.
- [ ] Añadir health de liveness, readiness, BD, proveedores y antigüedad de datos.

## Prioridad P1 — robustez y operación

### Datos y BD

- [ ] Mantener `source_revision` y `import_id` en cada dato derivado.
- [ ] Importación `dry-run`, idempotente, transaccional y reversible.
- [ ] Guardar diferencias entre revisiones antes de activar una nueva.
- [ ] Separar tablas normalizadas: `imports`, `sources`, `assets`, `cabinets`, `documentary_observations`, `network_observations`, `reconciliation_jobs`, `asset_edits` y `audit_log`.
- [ ] Mantener una proyección JSON solo si aporta compatibilidad; no usarla como modelo único a largo plazo.
- [ ] Habilitar WAL, índices, límites de crecimiento y `VACUUM` controlado.
- [ ] Preparar migración PostgreSQL solo cuando concurrencia, volumen o alta disponibilidad lo exijan.

### Contrato HTTP

- [ ] Congelar `/api/v1`, `operation_id`, envelope, códigos de error y paginación.
- [ ] Añadir ejemplos OpenAPI para éxito, parcial, conflicto, timeout y proveedor caído.
- [ ] ETags o `If-Match` para catálogo y correcciones.
- [ ] `Idempotency-Key` para importaciones, jobs y futuras escrituras masivas.
- [ ] Endpoint de importación administrativa separado de consultas normales.
- [ ] Endpoint de diferencias entre revisiones.
- [ ] Endpoints bulk para exportación, revisión y confirmación de correspondencias.
- [ ] No exponer payload crudo de proveedores; solo campos allowlisted y procedencia.

### Jobs y proveedores

- [ ] Mantener jobs asíncronos con estados `queued`, `running`, `completed`, `partial` y `failed`.
- [ ] Reintentos limitados únicamente en lecturas idempotentes.
- [ ] Backoff, circuit breaker y límite de concurrencia por proveedor.
- [ ] Caché breve de respuestas; nunca ocultar edad de datos.
- [ ] Tiempo de consulta, latencia, código HTTP, cantidad y error sanitizado por proveedor.
- [ ] Evitar una consulta por cámara; cada ciclo debe consultar proveedores una vez.
- [ ] Job de reconciliación programado configurable, desactivado por defecto en desarrollo.

### Dashboard

- [ ] Mantener Dashboard como único consumidor de Inventarios.
- [ ] Cambiar el gateway a `202 + job_id` y polling visible; evitar bloquear una petición HTTP durante todo el cotejo.
- [ ] Retirar rutas legacy de CCTV solo después de medir uso y probar rollback.
- [ ] Mostrar documental, corrección, red, identidad y video en bloques separados.
- [ ] Mostrar revisión, fecha de observación, proveedor y causa de cada estado.
- [ ] No permitir que una ausencia cambie automáticamente una baja administrativa.

## Prioridad P2 — ampliaciones

- [ ] Adaptador de switches: puerto, MAC aprendida, PoE y enlace.
- [ ] Adaptador CCTV/NVR: canal, grabación, almacenamiento, retención, FPS, códec y eventos.
- [ ] Notificaciones para cambios de IP, desaparición, identidad ambigua y proveedor caído.
- [ ] Webhooks o eventos internos solo después de definir reintento y firma.
- [ ] SDK cliente generado desde OpenAPI.
- [ ] PostgreSQL y almacenamiento de objetos para despliegues multiinstancia.
- [ ] Métricas Prometheus/OpenTelemetry si existe infraestructura receptora.

## Modelo de datos recomendado

| Entidad | Propósito | Regla |
|---|---|---|
| `asset` | Activo documental actual o histórico | ID estable; histórico solo lectura |
| `source` | Archivo y procedencia | Huella obligatoria |
| `documentary_observation` | Nota extraída de documentos | No mezclar con observación de red |
| `asset_edit` | Corrección efectiva | Versionada y auditable |
| `network_observation` | Dato de proveedor por ciclo | Nunca sobrescribir historia |
| `reconciliation_job` | Ciclo de cotejo | Estado y resultado persistidos |
| `identity_link` | Correspondencia confirmada | Actor, confianza y evidencia |
| `audit_event` | Acción operativa | Sin secretos ni payload crudo |

## Contrato de estados

- `matched`: identidad confirmada; IP puede coincidir o no.
- `changed`: identidad confirmada; IP observada difiere de la documental.
- `ambiguous`: hay más de una identidad válida o contradicción.
- `not_observed`: proveedores disponibles, sin coincidencia confirmada.
- `unavailable`: proveedor o respuesta no disponible.
- `partial`: ciclo terminó con al menos una fuente incompleta.

Prohibiciones: IP sola no identifica; ausencia no equivale a offline; baja administrativa no apaga; VLAN de interfaz no prueba puerto de acceso; interfaz activa no prueba video.

## Seguridad

- Claves separadas: lectura, escritura, exportación, importación y dashboard.
- Secretos fuera de Git, respuestas, logs y backups no cifrados.
- TLS para proveedores remotos; CA explícita cuando aplique.
- CORS y `ALLOWED_HOSTS` explícitos en producción.
- 2FA y expiración de sesión para operadores.
- Rate limit, tamaño máximo, SSRF controlado y allowlist de campos.
- Auditoría de importaciones, correcciones, revisión manual y exportaciones.
- Rotación documentada con prueba de rollback.

## Observabilidad

Registrar por request y job: `request_id`, actor no sensible, endpoint, duración, estado, revisión, proveedor, latencia, cantidad, edad de datos y error sanitizado.

Alertas mínimas:

- BD no disponible.
- Catálogo no importado.
- Último cotejo vencido.
- Proveedor con fallos consecutivos.
- Aumento anormal de `only_api` o `ambiguous`.
- Cambio documental sin revisión aprobada.

## Pruebas requeridas

- Contrato OpenAPI y envelope de errores.
- Autenticación, permisos, CSRF del gateway y no exposición de secretos.
- Importación idempotente, conflicto, huérfanos, rollback y restauración.
- MAC/serie duplicada, serie contradictoria, IP reutilizada y proveedor parcial.
- Reconciliación concurrente: un solo job activo.
- Retención de historia y revisión de catálogo incompatible.
- Exportación segura contra fórmulas CSV.
- Integración real con Forti/Omni usando fixtures y una prueba controlada.
- Playwright del flujo Dashboard: catálogo, cotejo, detalle, corrección y error parcial.
- Prueba de carga antes de sustituir SQLite.

## Documentación requerida

- `README.md`: instalación, ejecución, configuración y límites.
- `PLAN_IMPLEMENTACION.md`: fases, cierre y rollback.
- `ROADMAP.md`: backlog y decisiones futuras.
- `/GLOSSARY.md`: lenguaje de dominio.
- `docs/adr/`: decisiones difíciles de revertir.
- Scalar/OpenAPI: contratos ejecutables y ejemplos.
- Runbook de importación: dry-run, activación, rollback y restauración.
- Runbook de cotejo: estados, identidad, fallos y revisión manual.
- Runbook de incidentes: proveedor caído, BD dañada, secreto expuesto y revisión incorrecta.
- Diccionario de datos: campos, tipos, procedencia, vigencia y confidencialidad.
- Changelog por versión de API.

## Orden recomendado

1. Identidad y revisión manual.
2. Seguridad productiva y backups restaurables.
3. Importación versionada y esquema normalizado.
4. Jobs, observabilidad y gateway `202`.
5. Retiro controlado de legacy.
6. Switch/PoE y video/NVR.

## Criterio de cierre

API única para CCTV. BD recuperable. Cada dato con procedencia. Cada cotejo reproducible. Ningún estado inferido presentado como hecho. Dashboard sin escritura paralela. Documentación ejecutable por otra persona.
