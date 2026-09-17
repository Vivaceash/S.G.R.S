# Cotejo de fuentes de red y plan de integración

Fecha: 17 de septiembre de 2026. Alcance: análisis documental, contraste con JSON y consultas de solo lectura. No se implementan cambios ni se importan datos.

Fuentes: `/home/vivaceash/Documents/redes`; JSON de `origin/Casillas` en `b46e60770d2547971e71e38f1b67c5ac9479bd52`; archivos de trabajo actuales de Codex, cuyo HEAD es `71cf60a8340edecf0a72640259bb66b17afa4364`.

## Regla de autoridad

Por instrucción del usuario, las APIs son la referencia preferente para información operacional actual. Los documentos son evidencia histórica y complemento de inventario físico. Los JSON son una extracción derivada: no prevalecen sobre el documento que dicen representar ni sobre una observación vigente de las APIs.

La prioridad se aplica por campo, no reemplazando un registro entero:

| Información | Referencia para el cotejo | Límite |
| --- | --- | --- |
| IP observada, interfaz, reserva DHCP, VLAN y estado de red | FortiGate y, según el equipo, OmniVista | Registrar fecha, alcance y fuente; no confundir una reserva con presencia en línea |
| Identidad de equipo administrado, modelo, serie/MAC y estado | OmniVista, cuando efectivamente entregue esos campos | Confirmar esquema y cobertura con respuesta real; MAC de gestión y MAC de radio pueden diferir |
| IDF físico, rack, ubicación, serie documentada, equipo pasivo | Documentos y catálogo físico conciliado | Una descripción lógica de la API no prueba la ubicación física |
| Reubicación de cámara y anomalías del gabinete | Documento o registro de intervención | La detección de red no acredita la nueva ubicación ni que la cámara transmita video |
| Visitas, responsable, temperatura y resolución | Bitácora del sistema | No convertir observaciones de 2025 en visitas nuevas ni en alarmas vigentes |

Una consulta fallida o un equipo ausente del resultado significa «sin confirmar en esta consulta», no «baja», «fuera de línea» o «inexistente».

## Estado del cotejo con APIs

Se intentaron estas cinco consultas GET con la configuración existente, primero en el entorno restringido y luego con acceso autorizado:

- Forti: `/devices?view=operational`, `/network/interfaces`, `/network/dhcp-pools`.
- Omni: `/monitoring/devices`, `/catalogs/vlans`.

Todas devolvieron 502 desde el cliente de integración, que convierte errores de conexión en esa respuesta. Esto no equivale a un HTTP 502 emitido por los equipos. Las conexiones configuradas apuntan a `127.0.0.1:8001/api/v1` y `127.0.0.1:8000/api/v1`. La inspección de puertos confirmó que no había listeners en 8000/8001.

No se arrancaron servicios, no se cambiaron credenciales y no se consultaron cuentas de empleados ni tráfico individual. El cotejo en vivo queda pendiente hasta disponer de las APIs. No se han verificado conteos actuales, coincidencias con equipos activos ni configuración actual de VLANs.

## Archivos fuente y resultados

### Access points

`Formato_de_AP[1].docx`, fechado el 23 de julio de 2025, declara 126 APs y contiene una tabla con 126 registros. El documento afirma que sus datos fueron validados por INCOP y personal de Sistemas; esa declaración no es una comprobación independiente de su estado actual.

Los 126 registros corresponden al JSON `data/aps/aps.json`. Tras normalizar espacios, coinciden ID, modelo, serie y ubicación. La única diferencia es el AP 122: IDF vacío en el Word y `MDF / Sin Asignar` en JSON. Debe conservarse como «sin asignar», sin atribuirlo al MDF. Los IDs y las series son únicos; los conteos por modelo coinciden.

Pendiente de API: cotejar series y MACs disponibles contra infraestructura administrada de OmniVista. Si la respuesta no expone serie y el documento no tiene MAC, el enlace no puede hacerse de manera concluyente por nombre o IP.

### Inventario IDF/MDF

`CheckList completo IDFs.docx`, fechado el 17 de julio de 2025, declara 13 IDF y un MDF. Sus 14 tablas de inventario contienen 302 filas de contenido, y `data/idfs.json` conserva esas 302 filas en el mismo orden.

El cotejo de descripción, marca, serie, modelo, MAC y puertos encontró 169 diferencias de formato. Todas desaparecen al ignorar espacios, puntuación y mayúsculas; esa comparación tolerante no certifica igualdad textual. No se detectaron filas faltantes en esas tablas respecto del JSON.

Hay ocho filas que nombran racks: `RACK 2` en IDF 8 y siete racks del MDF. Son parte de la estructura física y no deben contarse sin distinción como ocho equipos activos. Una fila incluye marca (`rack 2 con puerta`, Linkec), por lo que tampoco corresponde descartarlas sin conservar su información. Separar contenedores/racks de equipos deja 294 filas restantes, no necesariamente 294 dispositivos de red.

Los campos `status`, `lastCheck`, `ru`, `rack`, `type` e `icon` del JSON no están respaldados por las seis columnas de esas tablas. No se deben considerar observaciones actuales verificadas. En particular, los 302 estados `online` no prueban disponibilidad. La ausencia de serie/MAC en pasivos o de posición RU en la fuente debe mantenerse como desconocida o no aplicable.

La tabla de observaciones del Word contiene 71 textos no vacíos. El JSON embebido tiene 73: agrega `Pintura levantada` en IDF 2 y en IDF 12, sin respaldo en el texto tabular de este documento. El archivo separado `data/idfs/observations.json` también tiene 73 entradas, pero presenta una duplicación y diferencias de contenido. No asumir que ambas listas son equivalentes. Esta comprobación es del texto tabular; no constituye una interpretación de las fotografías del documento.

La rama actual tiene 13 gabinetes y 192 equipos, incluidos 15 registros bajo PACS. Casillas usa IDF 13 y MDF y carece de `idf-pacs`, aunque conserva reportes con esa referencia. Ocho series y cuatro MACs coinciden entre PACS actual e IDF 13 de Casillas. Es un indicio de reclasificación, no autorización para fusionarlos. Mantener esa correspondencia como candidata hasta confirmarla.

### CCTV actualizado

`Actualización CCTV.xlsx`, hoja `Hoja1`, contiene 150 filas de cámara con número numérico. Las 150 están en `data/cctv/camaras_actualizadas.json` y coinciden en número, sección, ubicación, serie, modelo, IP, MAC y destino de reubicación tras normalizar espacios.

El JSON incluye además una cabecera (`num: Numero`, `ip: IP`, `mac: MAC`) como registro 151. Debe excluirse del inventario normalizado.

Hay diez casillas de reubicación activas y once destinos escritos en el Excel. La discrepancia concreta está en la fila 37, cámara 28: `H37=False`, pero `I37` contiene un destino. El JSON la marca reubicada. Conservar ambos datos y marcar el conflicto, sin resolverlo automáticamente por la presencia de texto.

Las 150 cámaras válidas tienen IP y MAC con formato válido y sin duplicados en ese catálogo. Esto valida estructura e identidad documental, no conectividad actual.

### CCTV original y relaciones omitidas

`CheckList CCTV.xlsx` contiene cuatro hojas: `TABLA IPS`, `ubicacion`, `MACS` y `Hoja1`. El JSON original representa las 149 filas de cámara de `ubicacion`, pero no conserva todas sus relaciones.

Los valores `A11`, `A2`, etc. del campo titulado IP son claves de consulta. La hoja `MACS` relaciona columna A (clave), B (MAC) y C (IP real); contiene 171 registros. Todas las claves usadas por las 149 filas se pueden resolver. Las celdas MAC de `ubicacion` usan fórmulas VLOOKUP contra esa hoja. Una importación correcta debe resolver el cruce y conservar la clave original, no tratarla como dirección IP.

Hay 23 entradas de `MACS` no utilizadas por las filas de ubicación. Son registros de red sin esa asociación y no equivalen automáticamente a 23 cámaras faltantes; incluyen direcciones de infraestructura.

La duplicación de MAC/clave detectada en JSON también está en la fuente: dos cámaras del IDF 7 comparten `A59`. No es un duplicado creado exclusivamente por la extracción. La versión actualizada distingue las identidades, pero la conciliación definitiva requiere cotejo actual.

La columna SITE discrepa con el encabezado de sección en 19 filas: cinco bajo IDF 5 señalan IDF 6 (filas 61–65), y catorce bajo IDF 10 señalan IDF 11 (filas 136–149). El JSON reproduce esa inconsistencia del Excel. Conservar encabezado y SITE por separado durante la revisión.

`TABLA IPS` incluye distribución, referencias NVR y anotaciones de avance que no están representadas en el JSON de cámaras. Son contexto documental; no sustituyen una lectura actual del NVR o de la red.

### Libro de estructura

`Estructura.xlsm` se abrió con la contraseña facilitada; el contenido descifrado se mantuvo en memoria. No se ejecutaron macros ni se guardó una copia descifrada. Contiene 20 hojas, celdas, fórmulas, objetos de dibujo y cuatro imágenes embebidas. Algunas hojas sin datos tabulares contienen diagramas, por lo que leer únicamente celdas sería insuficiente. Se inspeccionaron las celdas y la presencia de texto/IPs en objetos; no se verificaron visualmente todos los diagramas ni las imágenes.

Información útil para futuras comparaciones: catálogo de 24 VLANs en `Fortinet`; 23 asociaciones puerto/destino en `Switch Distribución`; inventario/resumen CCTV; almacenamiento y sistemas complementarios. Hay datos de acceso que deben quedar fuera de los catálogos, reportes compartidos y JSON públicos.

El resumen CCTV (filas 62–75) suma 155 instalaciones previstas y registradas, frente a las 150 cámaras del Excel actualizado. La diferencia se concentra en IDF 11 (24 frente a 20) y CASETA (1 frente a ningún registro separado). Es una discrepancia documental de cinco registros por identificar; no prueba cinco cámaras faltantes físicamente. El MDF tiene nueve en ambos documentos actualizados y ocho en el checklist original.

También hay contradicciones internas: `Fortinet` identifica Banco de sangre con VLAN 77 y Laboratorio con VLAN 74, mientras sus hojas específicas usan el rótulo VLAN 70. Las subredes coinciden, pero las VLANs deben verificarse mediante API. No trasladar esos valores al dashboard como configuración vigente.

## Plan de integración, sin implementación

1. Recuperar acceso a las APIs y tomar una consulta fechada de inventario administrado, dispositivos operacionales, interfaces, VLANs, ARP/DHCP y reservas según disponibilidad. Documentar paginación, filtros, caché y cobertura. No usar conteos de una muestra como total global.
2. Preparar una extracción normalizada de los documentos en un área de revisión: omitir cabeceras, distinguir racks/equipos, resolver la tabla MACS, preservar valores originales y marcar los conflictos anteriores. No modificar los JSON operativos.
3. Asociar registros por identidad estable: serie validada y/o MAC normalizada, considerando MAC de chasis/gestión/radio. IP, nombre y ubicación son evidencia auxiliar, no claves permanentes. Casos ambiguos quedan pendientes.
4. Emitir un cotejo con categorías: coincidencia confirmada, dato documental desactualizado, solo documento, solo API, referencia ambigua y fuente no disponible. Cada diferencia debe indicar documento/hoja/celda o tabla/fila, endpoint y fecha de observación.
5. Definir el modelo unificado separando identidad del activo, ubicación física documentada, observación actual de red, referencias históricas y procedencia. Añadir `source`, `observed_at`, `source_file`, `sheet/table`, `row` y un estado de validación. Nunca asignar `online` por defecto al importar.
6. Proponer la adaptación de lógica a los componentes actuales del dashboard. Conservar el diseño, navegación y métricas operacionales existentes. El catálogo documental complementará los equipos vistos por las APIs sin convertir las ausencias en bajas ni sobrescribir valores actuales con datos históricos.

Entregable pendiente: matriz real documento–JSON–API. La parte documento–JSON está cotejada; la columna API permanece sin confirmar por indisponibilidad de los servicios configurados.

## Huellas de los originales revisados (SHA-256)

| Archivo | SHA-256 |
| --- | --- |
| Actualización CCTV.xlsx | `c4405da9d36beb21096e9f8bbac69a5b2c4ecb6993e3310319a2d312aaba4cf6` |
| CheckList CCTV.xlsx | `d2e397ae36c25b4b8aad686a68d5b6c3c887362303870fc64283e28949d67e25` |
| CheckList completo IDFs.docx | `009aed90d2fae73d8352c6157531ae968639ce61dcbdd18bf193925a85908263` |
| Estructura.xlsm | `6b1eae54afaffc57dc157cee09608239d79007068cc9d0e0b09f0f7bdd079cb2` |
| Formato_de_AP[1].docx | `f78d14afee1fad2341b1df706601c5fcbc37d36ad6e4fdbc4aa3ce448c88b00e` |
# Actualización de implementación · 17 de septiembre de 2026

El usuario autorizó comenzar la implementación después de este análisis. Véase `INVENTARIO_DOCUMENTAL.md` para alcance, importación y validación. La extracción XML final recuperó 72 observaciones IDF, frente a 71 del análisis inicial, al incluir una nota de tabla anidada; no añadió gabinetes ni equipos. La validación conectada permanece pendiente: las APIs locales estaban detenidas.
