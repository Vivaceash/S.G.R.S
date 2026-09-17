# Inventario documental: operación y límites

Esta integración conserva el dashboard React de la rama actual. Añade consulta documental de IDF, AP y CCTV, correcciones físicas auditadas, cotejo de solo lectura con APIs y resolución de incidencias. No importa las pantallas de Casillas ni cambia configuraciones de red.

## Importación

Desde la raíz del proyecto:

```bash
.venv/bin/python scripts/import_documentary_inventory.py /home/vivaceash/Documents/redes
```

El resultado privado es `.sgrs-private/documentary.json` (ignorado por Git). Los originales no se modifican. Para revisar una nueva extracción antes de sustituirla, utilizar `--output /tmp/documentary-review.json`; `--replace` autoriza reemplazar exclusivamente el catálogo extraído. Las correcciones se almacenan separadamente en SQLite.

`--structure` requiere `msoffcrypto-tool` en el entorno del importador y solicita la contraseña interactivamente. El XLSM se descifra en memoria; no se ejecutan macros. Solo se admiten las celdas de resumen de VLAN, distribución y conteos CCTV. No guardar contraseñas en scripts, argumentos, logs o el repositorio.

La extracción comprobada contiene 302 renglones IDF (8 contenedores/racks), 126 AP, 150 cámaras actualizadas y 149 cámaras del inventario histórico. Son conjuntos de fuentes diferentes, no un total de equipos únicos. Hay 14 gabinetes documentales; PACS continúa separado de IDF 13. AP122 permanece sin gabinete confirmado. Se conservan los conflictos de reubicación, duplicados e inconsistencias de SITE.

Se extraen 72 observaciones IDF: la lectura XML incluye la nota «Pintura levantada» de una tabla anidada que no aparecía en las 71 observaciones del primer análisis. La tabla anidada no se cuenta como gabinete adicional.

## Prioridad y seguridad

El cotejo consulta los proveedores configurados en Conexiones API. MAC o serie únicas vinculan registros; IP/nombre por sí solos no lo hacen. La IP actual se muestra junto a la documental sin sobrescribirla. Fuentes caídas, registros no observados y conflictos se distinguen expresamente. Se permite corregir datos físicos, no manipular identidad de red ni estado operativo.

`GET /api/inventory/catalog` y `/api/inventory/reconcile` requieren sesión. `POST /api/inventory/asset` exige `inventory.write`, CSRF y versión vigente. Las descargas en `/api/inventory/documents/<sha256>` exigen `inventory.export`; el XLSM está excluido. Resolver incidencias mediante `/api/reports/resolve` exige `idf.visits.write` y CSRF, preservando evidencia e historial.

Al reimportar, revisar cambios de identidad: los IDs se derivan de datos documentales estables, pero modificar MAC/serie/nombre o duplicados puede producir un nuevo ID. No se migran correcciones silenciosamente entre identidades. Respaldar el catálogo privado y SQLite antes de una actualización operativa.

## Verificación

```bash
.venv/bin/python -m pytest tests/test_documentary_inventory.py tests/test_dashboard_access.py tests/test_dashboard_catalog.py -q
npm --prefix Dashboard test
npm --prefix Dashboard run build
# Con Vite activo; todas las APIs del navegador se interceptan:
node Dashboard/tests/inventory-browser.mjs
```

La prueba de navegador cubre prioridad API, fuente parcial, edición filtrada por ID, conflictos, borradores, históricos, filtros, paginación, móvil, accesibilidad automática, recuperación de errores y demo sin API. Las capturas se guardan por defecto en `/tmp/sgrs-inventory-browser`.

Pendiente antes de producción: cotejo conectado con FortiGate/OmniVista, revisión humana de coincidencias ambiguas y de PACS/IDF13, comprobación de permisos con cuentas institucionales y accesibilidad con tecnologías de asistencia. Por indicación expresa del usuario, la validación con APIs reales queda fuera de esta etapa: los contratos y fallos se verifican con pruebas controladas, no con dispositivos reales. Los dos procesos de API iniciados brevemente para preparar esa comprobación fueron detenidos sin ejecutar el cotejo conectado.
