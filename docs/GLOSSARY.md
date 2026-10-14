# SGRS — Inventario y observabilidad de red

Lenguaje común para Inventarios, Dashboard, FortiGate y OmniVista. Distingue hechos documentales, correcciones operativas y observaciones obtenidas de la red.

## Inventario

**Activo**: Equipo o recurso identificado por el inventario documental.

_Evitar_: dispositivo, cámara, registro, cuando se hable del recurso como entidad de inventario.

**Inventario actual**: Conjunto de activos CCTV vigentes para operación.

**Histórico**: Registro documental conservado como referencia; no representa un activo actual editable.

**Gabinete**: IDF o ubicación documental que agrupa activos.

**Corrección física**: Cambio auditado sobre datos físicos o administrativos del activo; no modifica el original documental.

**Baja administrativa**: Estado de inventario que indica retiro o desactivación administrativa; no prueba que el equipo esté apagado.

**Reubicación**: Cambio administrativo de ubicación del activo con destino explícito.

## Fuentes y evidencia

**Fuente documental**: Archivo, hoja, tabla, fila y huella que respaldan un dato importado.

**Revisión documental**: Versión inmutable del catálogo identificada por la huella de sus fuentes.

**Observación documental**: Nota o dato extraído de una fuente documental, asociado normalmente a un gabinete o activo.

**Procedencia**: Explicación de dónde proviene un valor, cuándo fue observado y con qué confianza puede usarse.

## Red y cotejo

**Identidad de equipo**: Evidencia que vincula un activo documental con un equipo observado; requiere MAC o serie válida y no ambigua.

**Observación de red**: Dato reportado por FortiGate u OmniVista en un ciclo de consulta.

**Cotejo**: Comparación entre activos documentales y observaciones de red.

**Resultado de cotejo**: Estado de identidad: `matched`, `changed`, `ambiguous`, `not_observed` o `unavailable`.

**Job de cotejo**: Ejecución persistida y consultable de un cotejo.

**Registro solo API**: Equipo observado por un proveedor sin identidad documental confirmada.

**Ausencia de observación**: Falta de coincidencia en un ciclo; no significa equipo fuera de servicio.

**Estado de red**: Estado reportado por un proveedor; no equivale a salud de video.

**Relación VLAN**: Asociación entre un activo observado y una configuración de interfaz; debe declarar si fue observada o inferida por subred.

## Integración

**Proveedor**: API externa consultada por Inventarios, actualmente FortiGate u OmniVista.

**Adaptador**: Implementación que transforma el contrato de un proveedor al modelo interno.

**Fuente operativa**: Sistema autorizado para leer y escribir un dato. Inventarios será la fuente operativa de CCTV; los archivos seguirán siendo evidencia documental.
