---
version: alpha
name: "S.G.R.S. NOC Console"
description: "Consola operacional oscura para observabilidad de red y respuesta rápida del equipo NOC."
colors:
  background: "#071018"
  sidebar: "#09141E"
  surface: "#0E1C28"
  raised: "#122432"
  border: "#203746"
  text: "#EDF7FB"
  muted: "#829AAA"
  primary: "#34D5E7"
  success: "#54D39A"
  warning: "#F0B35A"
  danger: "#EF6B62"
typography:
  sans:
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
spacing:
  control: "0.5rem"
  panel: "1.25rem"
  section: "1.5rem"
components:
  button: { }
  card: { }
  dialog: { }
  table: { }
---

# S.G.R.S. NOC Console Design System

## Overview

La referencia es una consola NOC física: superficies oscuras, jerarquía por capas y señales cromáticas reservadas para estado. El público es personal de redes que trabaja en escritorio, frecuentemente bajo presión, y necesita reconocer degradaciones sin ornamentación. Es una interfaz de producto en español de México.

La firma visual es la ruta de señal cyan que conecta Internet, firewall, núcleo y acceso. El resto de la interfaz debe ser sobrio y denso. Debe evitar la estética de landing page, gradientes decorativos, tarjetas gigantes y animaciones que retrasen la lectura.

Los tokens de ejecución en `Dashboard/src/index.css` son la fuente canónica; este documento refleja sus valores y explica su uso. Los componentes consumen esos tokens mediante variables CSS o utilidades equivalentes de Tailwind.

## Colors

`background`, `sidebar`, `surface` y `raised` forman la profundidad operacional. `primary` identifica conectividad, foco y acción principal; no se usa como decoración. `success`, `warning` y `danger` siempre se acompañan con texto o icono. `text` y `muted` mantienen dos niveles de lectura sobre todas las superficies.

## Typography

Segoe UI y sus fallbacks del sistema priorizan legibilidad y disponibilidad sin descargas tardías. Direcciones IP, MAC, identificadores y métricas técnicas usan la familia monoespaciada. Las etiquetas operacionales pueden usar mayúsculas y tracking; el texto explicativo conserva sentence case.

## Layout

La consola privilegia escritorio y conserva desplazamiento horizontal explícito en tablas. Los paneles usan ritmo compacto, bordes persistentes y separación de 20–24 px. En pantallas estrechas los controles se apilan sin ocultar acciones ni crear un segundo scroll vertical innecesario.

## Elevation & Depth

La jerarquía proviene de tonos y bordes. Las sombras se reservan para overlays; las tarjetas estáticas permanecen planas. El fondo desenfocado pertenece únicamente a diálogos modales.

## Shapes

Controles y campos usan radio medio; paneles y diálogos usan radio grande. Estados y conteos pueden usar píldoras cuando su forma comunica etiqueta o estado. Los iconos conservan trazo uniforme mediante Lucide.

## Components

Los controles interactivos necesitan estados hover, focus-visible, active, disabled y busy sin cambios de tamaño. El foco usa `primary` con separación visible. Los formularios muestran errores en texto asociado al campo o como alerta persistente; nunca mediante mensajes nativos o secretos en notificaciones.

Las tablas son compactas, semánticas y paginadas. Los diálogos contienen el foco, responden a Escape, restauran el foco del disparador y mantienen acciones visibles. El movimiento comunica apertura o estado y se reduce con `prefers-reduced-motion`.

## Do's and Don'ts

- **Do:** reservar cyan y colores semánticos para decisiones y estado real.
- **Do:** mantener datos técnicos escaneables y alineados con tipografía monoespaciada.
- **Don't:** introducir colores crudos nuevos sin asignarles un rol compartido.
- **Don't:** almacenar secretos en persistencia del navegador ni mostrarlos en errores o exportaciones.
