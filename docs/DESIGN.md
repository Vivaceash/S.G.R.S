---
version: alpha
name: "SGRS · Centro Operativo ISSSTE"
description: "Consola institucional de redes, inventario y registros de acceso a IDF."
colors:
  background: "#faf9f7"
  surface: "#ffffff"
  surfaceMuted: "#f3efeb"
  sidebar: "#530e28"
  border: "#e7dfd9"
  text: "#252936"
  muted: "#666875"
  primary: "#611232"
  gold: "#a67c42"
  success: "#087647"
  warning: "#946000"
  danger: "#ae1234"
  info: "#2358a5"
typography:
  display:
    fontFamily: "Georgia, Times New Roman, serif"
  sans:
    fontFamily: "Segoe UI, Helvetica Neue, Arial, sans-serif"
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
rounded:
  DEFAULT: "8px"
  panel: "14px"
spacing:
  control: "8px"
  panel: "20px"
  section: "24px"
components:
  button:
    rounded: "8px"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
  panel:
    rounded: "14px"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  dialog:
    rounded: "15px"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
---

# Centro Operativo · Diseño institucional

## Overview

Producto para el personal de redes e infraestructura del ISSSTE. Español de México, operación de escritorio y registro en sitio desde móvil. El rediseño integral fue solicitado con cinco capturas de referencia y React/Tailwind el 10 de septiembre de 2026.

La firma visual es el encabezado institucional, la navegación lateral guinda y los títulos serif acompañados por una regla dorada. Las tarjetas de segmento conservan la jerarquía de la referencia: nombre, VLAN/subred, gateway/máscara, capacidad, contexto y acceso al inventario.

Referencias: `dashboard 1.png`, `altas de red.png`, `inventario.png`, `redes disponibles.png` y `bitacora.png` en la carpeta entregada por el usuario. La última captura corresponde al formulario de entrada IDF, por lo que se implementa esa vista además de una bitácora tabular.

El wordmark proviene de la captura proporcionada: `Dashboard/src/assets/brand-reference.png`, mostrado mediante una ventana CSS sin alterar el archivo. Debe reemplazarse por el asset oficial optimizado cuando esté disponible; la referencia completa pesa aproximadamente 1.36 MB. El ornamento lateral es un SVG local discreto y no pretende sustituir el escudo oficial.

## Colors

Guinda para identidad y acciones, marfil para el fondo, blanco para superficies y dorado para orientación. Verde, ámbar, rojo y azul comunican estados siempre junto a texto. La demo lleva una etiqueta persistente; los datos reales no se sustituyen automáticamente por fixtures.

## Typography

Georgia en encabezados institucionales; Segoe UI en controles, tablas y cuerpo; Cascadia Code/Consolas en IPs, MACs e identificadores técnicos. Fuentes de sistema para evitar dependencias de red y cambios de geometría tardíos. Tamaños: título 27–38 px, sección 21–23 px, controles/tablas 12–14 px. En campos móviles se usa 16 px.

## Layout

Encabezado de 82 px y sidebar de 238 px en escritorio amplio. Contenido con margen de 35 px, métricas compactas y tres columnas de segmentos. A 1450 px el estado circular ocupa una fila propia; a 1150 px se reorganizan las métricas y segmentos; a 850 px la navegación pasa a diálogo móvil; a 600 px formularios de una columna.

La página posee el scroll vertical. Las tablas tienen un área propia con scroll y altura máxima de 565 px; los formularios tienen altura natural. Tablas comparativas conservan columnas mediante desplazamiento horizontal. Las acciones móviles siguen accesibles.

Ampliación solicitada: Usuarios y privilegios y Conexiones API se agrupan al final del sidebar bajo Administración, solo para super-admin. Conservan paneles, tablas, campos y mensajes compartidos; no introducen otra identidad visual. Las tarjetas de rol explican capacidades antes de crear una cuenta.

Decisión de visibilidad posterior: el catálogo de roles lo proporciona la sesión desde el servidor. Viewer y admin solo reciben Viewer y Administrador; el nivel interno no aparece en sus perfiles, ayudas, demo ni mensajes de denegación. Las funciones técnicas no aplicables se omiten, no se anuncian como una mejora de nivel. No cambian los tokens, la composición ni las primitivas visuales. Política y límites: `USUARIOS_Y_CONEXIONES.md`, sección Jerarquía visible e interna.

Registro IDF deja de ser un listado de gabinetes: hasta 850 px presenta la composición móvil de `bitacora.png`, con iconos en campos, temperatura/fecha en dos columnas, carga fotográfica con borde discontinuo y acciones apiladas (registrar antes de limpiar). Por encima de 850 px solo se muestran reportes e incidencias. Este cambio de tarea por dispositivo es una decisión explícita del usuario, no una regla general para otras pantallas.

## Elevation & Depth

Bordes cálidos y sombra tenue en tarjetas, conforme a las referencias. Diálogos con sombra y backdrop; no añadir desenfoque al contenido ni animación decorativa permanente.

## Shapes

Controles de 8 px, paneles de 14 px y diálogos de 15 px. Píldoras para estados. Iconos Lucide con trazo uniforme. Ornamento de pluma de bajo contraste solo en áreas institucionales.

## Components

Modelo B: `Dashboard/src/styles.css` es el origen canónico de tokens de ejecución; este documento refleja los valores aceptados y su intención. Tailwind v4 consume `@theme`; las clases de componentes consumen las mismas variables, sin un segundo theme JS.

| Token del documento | Variable canónica | Consumidores |
| --- | --- | --- |
| colors.primary | --color-brand | Button, enlaces, encabezados, estado activo |
| colors.gold | --color-gold | Foco y orientación |
| colors.success/warning/danger/info | --color-success/warning/danger/info | Badge, Notice, métricas |
| colors.background/surface/surfaceMuted | --background/--surface/--surface-muted | Documento y paneles |
| colors.sidebar/border/text/muted | --sidebar/--border/--text/--muted | Shell, tablas y texto |
| typography.display/sans/mono | --font-display/--font-sans/--font-mono | Encabezados, controles, datos |
| rounded.DEFAULT/panel | --radius-control/--radius-panel | Campos y paneles |
| spacing.* | Ritmo documentado, utilities de Tailwind | Distribución y separación |

Primitivas compartidas en `Dashboard/src/components.jsx`: Button, IconButton, SearchField, Select, Field, Notice, Note, Metric, Dialog, DataTable y paginación. Los contratos de interacción están en `UX-CONTRACT.md`.

Field incorpora el icono de entrada como variante; SecretInput es el único propietario de campos de contraseña/clave con revelado. Usuarios, conexiones e ingreso reutilizan useForm, Notice y Dialog. No se añaden fuentes ni tokens independientes; la ampliación consume la misma paleta y radios.

## Do's and Don'ts

- Mantener títulos, filtros, totales y procedencia legibles.
- Usar estado explícito sin inventar una identidad autenticada.
- Reutilizar las primitivas y el sistema de colores.
- No volver a la consola azul oscura: era una descripción desactualizada del diseño anterior.
- No mostrar éxito antes de confirmar el servidor ni almacenar secretos o borradores personales en localStorage.

## Reconciliación del diseño anterior

| Evidencia anterior | Resolución |
| --- | --- |
| DESIGN.md describía colores oscuros y src/index.css inexistente | Se sustituye por la identidad guinda solicitada y src/styles.css real |
| Dashboard/DESIGN.md duplicaba otros tokens | Se convierte en referencia al contrato raíz |
| HTML/JS antiguos junto a las vistas | Se conservan como referencia de migración; Vite compila solo la entrada React |
| Métricas mezclaban ejemplos y respuestas reales | Modo demo explícito; datos del sistema etiquetados con límites de procedencia |
| Registro IDF era una tabla de gabinetes | Sustituida por formulario móvil y reportes de escritorio, por petición expresa |
| Perfil local sin identidad y enlaces administrativos ausentes | Cuenta/rol reales en sistema; administración inferior solo para super-admin; demo inequívoca |

Verificación visual: capturas en `Dashboard/artifacts/`; contratos y prueba de accesibilidad en `Dashboard/tests/browser.mjs`. Estos controles no equivalen a certificación de accesibilidad ni a una auditoría de seguridad completa.

Ampliación de consultas (11 de septiembre de 2026): se conserva la identidad y los tokens existentes. Las nuevas vistas técnicas reutilizan la tabla, selector nativo y diálogo canónicos; la selección de fuente permanece en la URL. Navegación técnica antes de Usuarios/Conexiones, que siguen al final del sidebar. Cada tabla distingue bloque recibido, histórico agregado y fuente no disponible. Los controles de archivo visualmente ocultos conservan dimensiones de 1 px para no desbordar el formulario móvil.
