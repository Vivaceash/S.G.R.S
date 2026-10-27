# API `personal.v1` — contrato para sistemas consumidores

Versión 1 — 2026-09-14. Servicio de **solo lectura** sobre la plantilla de
personal de SIPAC. Cada sistema recibe únicamente los campos que RH le
autorizó en el panel del orquestador; lo no autorizado **no aparece** en la
respuesta (ni como `null`).

Versiones interactivas: Swagger UI en `/docs` y OpenAPI en `/docs/openapi.json`
del propio servidor del orquestador.

## Autenticación

Cada sistema recibe una llave con el formato `orq_<prefijo>.<secreto>`. Se
envía en todas las peticiones:

```
Authorization: Bearer orq_zvi9tpeh.k4m7…
```

- La llave se muestra una sola vez al crearla. Si se pierde, se rota en el
  panel (la anterior deja de funcionar de inmediato).
- Llave revocada o vencida → `401`. Sistema desactivado → `403`.
- Límite de tasa por llave (por defecto 60 peticiones por minuto; ajustable
  por sistema). Al excederlo: `429` con encabezado `Retry-After` (segundos).

## Formato general

- JSON UTF-8. Fechas `YYYY-MM-DD`; horas `HH:MM`; marcas de tiempo ISO-8601 en UTC.
- `numero_empleado` siempre es **string** (conserva ceros a la izquierda).
- Errores, siempre con la misma forma:

```json
{ "error": { "codigo": "PROHIBIDO", "mensaje": "…", "detalles": { } } }
```

| HTTP | codigo | Cuándo |
|---|---|---|
| 400 | `VALIDACION` | parámetro inválido (`detalles` lista los problemas) |
| 401 | `NO_AUTORIZADO` | sin llave, llave inválida, revocada o vencida |
| 403 | `PROHIBIDO` | operación o campo no autorizado (`detalles.disponibles` dice qué sí) |
| 404 | `NO_ENCONTRADO` | persona o catálogo inexistente |
| 429 | `LIMITE_EXCEDIDO` | límite de tasa; ver `Retry-After` |
| 503 | `API_DESHABILITADA` | la API se deshabilitó temporalmente desde el panel |

- Respuestas con `Cache-Control: private, max-age=60` (catálogos: 300 s).

## Selección de campos: `campos=`

Opcional. Lista separada por comas para pedir un subconjunto de lo
autorizado. Los del recurso `fm1` llevan prefijo `fm1.`:

```
?campos=nombre_completo,status_laboral,fm1.servicio,fm1.puesto
```

Pedir un campo no autorizado responde `403` con la lista de campos
disponibles para ese sistema. Sin `campos=` se devuelven todos los
autorizados.

## Operaciones

Cada sistema tiene autorizadas cero o más operaciones: `consultar`, `buscar`,
`historial`, `catalogos`.

### `GET /v1/personal/{numero_empleado}` — operación `consultar`

```json
{
  "numero_empleado": "436850",
  "nombre": "MARIA DE LOURDES",
  "apellidos": "AGRAMON CALDERON",
  "nombre_completo": "MARIA DE LOURDES AGRAMON CALDERON",
  "status_laboral": "ACTIVO",
  "coordinacion": "COORDINACIÓN DE ENLACE HOSPITALARIO",
  "fm1": {
    "numero_plaza": "906843",
    "servicio": "TRABAJO SOCIAL",
    "puesto": "SUPERVISORA DE TRABAJO SOCIAL EN AREA MEDICA \"B\"",
    "turno": "MAR-JUE-SAB 11 HRS NOCT",
    "horario_entrada": "20:00",
    "horario_salida": "07:00",
    "dias_laborales": [2, 4, 6]
  }
}
```

- `fm1` solo aparece si el sistema tiene campos autorizados de ese recurso;
  vale `null` si la persona no tiene FM-1 vigente hoy.
- `404` si el número no existe.

### `GET /v1/personal` — operación `buscar`

Parámetros: `buscar` (nombre sin importar acentos, o número exacto),
`status` (`ACTIVO`, `INACTIVO`, `LICENCIA`, `PENDIENTE`), `servicio` (nombre
o id), `coordinacion` (nombre), `pagina` (desde 1), `por_pagina` (1 a 200,
por defecto 50), `campos`.

```json
{ "datos": [ { …misma forma que consultar… } ], "total": 37, "pagina": 1, "por_pagina": 50 }
```

### `GET /v1/personal/{numero_empleado}/fm1` — `consultar` / `historial`

- Sin parámetros: `{ "numero_empleado", "fm1": { … } | null }` (vigente).
- `?historial=1`: `{ "numero_empleado", "historial": [ { … }, … ] }` con
  todos los movimientos, del más reciente al más antiguo. Requiere la
  operación `historial`.

### `GET /v1/catalogos/{tipo}` — operación `catalogos`

`tipo` ∈ `servicios`, `puestos`, `coordinaciones`, `turnos`, `ubicaciones`.

```json
{ "tipo": "turnos", "datos": [ { "id": "…", "nombre": "LUNES A VIERNES MATUTINO", "activo": true } ] }
```

## Campos disponibles

### Recurso `personal`

| campo | tipo | notas |
|---|---|---|
| numero_empleado | string | siempre presente |
| nombre, apellidos, nombre_completo | string | |
| status_laboral | string | ACTIVO, INACTIVO, LICENCIA, PENDIENTE |
| activo, exento | boolean | |
| coordinacion, ubicacion | string | variables del empleado (catálogos de SIPAC) |
| genero, nacionalidad, escolaridad, cedula | string | |
| fecha_ingreso, fecha_nacimiento* | date | |
| rfc*, curp*, cuip*, telefono*, direccion* | string | |
| numero_hijos* | number | |
| expuesto_radiologia | boolean | |
| tipo_biometrico | string | |
| updated_at | timestamp | |

### Recurso `fm1` (FM-1 vigente: cubre hoy en hora de México y no cancelada)

| campo | tipo | notas |
|---|---|---|
| tipo_movimiento, motivo | string | |
| fecha_efectos, fecha_fin, fecha_termino | date | |
| fecha_estimada | boolean | true si la fecha la derivó la sincronización |
| numero_plaza, servicio, puesto, turno, turno_clave | string | |
| tipo_nombramiento | string | BASE, CONFIANZA, EVENTUAL, INTERINO |
| clave_presupuestal*, codigo_puesto, nivel_salarial* | string | |
| horario_entrada, horario_salida, horario2_entrada, horario2_salida | time | |
| dias_laborales | number[] | 0 = domingo … 6 = sábado |
| folio_fm1, estado, origen | string | `estado` útil en historial |
| updated_at | timestamp | |

`*` = dato sensible; el panel lo marca y RH debe autorizarlo expresamente.

## Salud

`GET /salud` (sin llave) → `200` si el servicio y ambas bases responden;
`503` en caso contrario. Útil para monitoreo.

## Buenas prácticas para el consumidor

- Guardar la llave en configuración segura (variable de entorno), nunca en
  el código ni en el cliente web.
- Cachear respuestas al menos 60 s; la plantilla cambia poco.
- Tratar `403` con `detalles.disponibles` como aviso de configuración: pedir
  a RH que autorice el campo en el panel, no reintentar.
- Reintentar `429` respetando `Retry-After` y `503` con espera exponencial.
