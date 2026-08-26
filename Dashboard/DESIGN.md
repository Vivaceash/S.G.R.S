---
version: alpha
colors:
  background: "#071018"
  sidebar: "#09141e"
  surface: "#0e1c28"
  surfaceRaised: "#122432"
  border: "#203746"
  text: "#edf7fb"
  muted: "#829aaa"
  signal: "#34d5e7"
  success: "#54d39a"
  warning: "#f0b35a"
  danger: "#ef6b62"
typography:
  display:
    fontFamily: "Bahnschrift, Arial Narrow, sans-serif"
  body:
    fontFamily: "Segoe UI, Tahoma, sans-serif"
  data:
    fontFamily: "Cascadia Code, Consolas, monospace"
rounded:
  small: "6px"
  DEFAULT: "10px"
spacing:
  compact: "4px"
  control: "8px"
  section: "16px"
  shell: "28px"
components:
  panel:
    background: "#0e1c28"
    border: "#172b38"
    radius: "10px"
  button:
    radius: "7px"
  focus:
    color: "#34d5e7"
    width: "2px"
---

## Overview

SGRS es un producto operativo para administradores de infraestructura y seguridad que necesitan detectar cambios antes de que afecten la operación. Su North Star es una consola NOC contemporánea: precisa, contenida y legible durante sesiones largas. El registro es de producto, no de marketing.

La firma visual es la **ruta de señal**: una línea viva que conecta Internet, firewall, núcleo y acceso, y resume la salud del sistema sin depender de gráficas genéricas. Debe aparecer con protagonismo sólo en el resumen general.

Evitar tableros “fintech” con tarjetas flotantes, gradientes decorativos, glassmorphism intenso o neón por todas partes. La expresividad se concentra en la señal; el resto es sobrio y denso.

## Colors

El fondo azul carbón reduce fatiga y diferencia al producto del negro genérico. `signal` identifica conectividad y foco; nunca reemplaza los colores semánticos. Success, warning y danger siempre se acompañan de texto, forma o icono.

La fuente de verdad de los tokens es este archivo. `styles.css :root` es el adaptador de ejecución y debe actualizarse en el mismo cambio.

## Typography

Bahnschrift se reserva para nombres de producto, encabezados y números grandes por su carácter técnico e industrial. Segoe UI mantiene legibilidad en texto de interfaz. Cascadia Code se usa en IPs, etiquetas de sistema, marcas de tiempo y datos compactos.

## Layout

La navegación persistente mide 248px en escritorio. El contenido usa una retícula de cuatro columnas para telemetría y una división 1.65/0.75 para inventario y bitácora. En móvil, el menú se convierte en drawer y todo fluye en una columna; las tablas conservan comparación mediante desplazamiento horizontal.

La densidad es compacta pero nunca sacrifica foco, contraste ni acceso al valor completo. El espaciado base deriva de 4px, con 16px entre paneles y 28px para el shell de escritorio.

## Elevation & Depth

Los paneles se separan por borde y variación tonal, no por sombras. Las sombras se reservan para capas flotantes: drawer, diálogo y toast.

## Shapes

Radios pequeños de 6–10px comunican precisión. Los círculos se reservan para nodos de red, avatares e indicadores de estado. No usar píldoras para contenedores o acciones principales.

## Components

Los paneles comparten fondo, borde y radio. Todo control interactivo expone hover, pressed, foco visible y disabled. La barra de desplazamiento es global. Las tablas son semánticas, mantienen encabezados ordenables con botones y usan un área de desplazamiento propia.

## Do's and Don'ts

- Sí: mostrar estado, contexto y última actualización juntos.
- Sí: escribir acciones con verbos concretos: “Registrar movimiento”, “Revisar eventos”.
- Sí: reservar geometría durante carga y mantener los controles estables.
- No: usar color como único indicador de severidad.
- No: ocultar overflow de tablas o depender de hover para revelar información esencial.
- No: multiplicar tarjetas redondeadas dentro de tarjetas.
