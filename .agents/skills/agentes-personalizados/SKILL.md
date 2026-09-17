---
name: agentes-personalizados
description: >-
  Guía y procedimiento completo para diseñar, configurar, crear e invocar agentes personalizados
  (Custom Agents) en Google Antigravity (Antigravity 2.0 y Antigravity CLI). Utiliza esta habilidad
  cuando el usuario desee definir nuevos agentes especializados, configurar sus archivos Markdown con
  frontmatter YAML, restringir herramientas (tools) o habilidades (skills), establecer permisos y
  políticas de ejecución de comandos (commandExecutionPolicy), o invocar agentes como agente principal
  (mainAgent) o subagente (subagent).
---

# Agentes Personalizados en Google Antigravity

Esta habilidad proporciona la guía completa para crear, estructurar e invocar **Agentes Personalizados (Custom Agents)** en proyectos de Google Antigravity (2.0 y CLI), basándose en la especificación oficial de Antigravity.

---

## 1. ¿Qué es un Agente Personalizado?

Un **Agente Personalizado** es una configuración basada en un único archivo Markdown (`.md`) que define un rol de IA especializado con:
- Instrucciones de sistema acotadas y específicas para un rol o dominio.
- Un subconjunto restringido de herramientas (`tools`) para evitar confusión y sobrecarga de contexto.
- Habilidades curadas (`skills`) pertinentes exclusivamente a su labor.
- Modelo de lenguaje optimizado (p. ej. `flash` para tareas rápidas, `pro` para razonamiento complejo).
- Políticas de seguridad y permisos específicos (`commandExecutionPolicy`, `permissionMode`).
- Capacidad simétrica de ejecución como agente principal (`mainAgent`) o como subagente (`subagent`).

### Ventajas clave:
1. **Evita la sobrecarga de contexto (Context Bloat):** No inyecta reglas globales masivas en chats donde no se requieren.
2. **Especialización y consistencia:** El agente conoce de antemano las convenciones, scripts de prueba y flujos específicos.
3. **Curación de habilidades y herramientas:** Solo recibe los comandos y skills relevantes para su objetivo.

---

## 2. Dónde se guardan los Agentes Personalizados

Antigravity descubre agentes en dos niveles:

| Nivel | Ruta de Almacenamiento | Propósito |
| :--- | :--- | :--- |
| **Proyecto / Workspace** | `.agents/agents/<nombre-agente>.md` | Específico del repositorio. Se puede compartir con el equipo o ignorar en `.gitignore`. |
| **Global / Usuario** | `~/.gemini/config/agents/<nombre-agente>.md` | Disponible en todos los proyectos y repositorios de la máquina local. |

> [!NOTE]
> Para agentes a nivel de proyecto, la ruta estándar es `.agents/agents/`. Si el proyecto requiere que no se versionen en Git, la carpeta `.agents/` debe incluirse en el archivo `.gitignore`.

---

## 3. Formato del Archivo del Agente (`<nombre>.md`)

El archivo consta de dos partes:
1. **Cabecera YAML Frontmatter:** Metadatos de ejecución, permisos, herramientas y modelo.
2. **Cuerpo en Markdown:** Instrucciones centrales que se compilan directamente en el **System Prompt** del agente.

### Estructura General:

```markdown
---
name: nombre-del-agente
description: Descripción detallada de qué hace y cuándo debe invocarse o delegarse tareas en él.
model: flash | pro | inherit
mainAgent: true | false
subagent: true | false
permissionMode: acceptEdits | bypassPermissions
commandExecutionPolicy: auto
tools:
  - view_file
  - replace_file_content
  - run_command
skills:
  - skills/mi-habilidad-especializada
---

# Core Instructions
Eres un agente especializado en...
Instrucciones, reglas de codificación, pasos a seguir y restricciones.
```

---

## 4. Campos del Frontmatter YAML

| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| **`name`** | `string` | Sí | Identificador único del agente (en minúsculas con guiones, ej. `dependency-modernizer`). |
| **`description`** | `string` | Sí | Describe el propósito del agente. Es fundamental: el agente coordinador la utiliza para saber cuándo delegar tareas en este agente. |
| **`model`** | `string` | No | Modelo que utilizará el agente (`flash`, `pro`, `inherit`, etc.). Por defecto hereda el modelo activo si no se define. |
| **`tools`** | `list<string>` | No | Lista blanca de herramientas permitidas (ej. `view_file`, `replace_file_content`, `run_command`, `manage_task`). Reduce el ruido y el consumo de tokens. |
| **`skills`** | `list<string>` | No | Rutas relativas a las habilidades curadas a las que tendrá acceso el agente (ej. `skills/package-upgrade-rules`). |
| **`mainAgent`** | `boolean` | No | `true` si el usuario puede iniciar una sesión interactiva directa con este agente (desde la GUI o CLI). |
| **`subagent`** | `boolean` | No | `true` si el agente puede ser invocado dinámicamente como subagente por un coordinador. |
| **`permissionMode`** | `string` | No | Nivel de permisos del agente (ej. `acceptEdits`, `bypassPermissions`). |
| **`commandExecutionPolicy`** | `string` | No | Filtro de seguridad de comandos. Con `auto`, ejecuta comandos estándar de compilación y pruebas en segundo plano de forma autónoma, requiriendo confirmación manual solo para acciones destructivas. |

Para especificaciones avanzadas, consulta [formato-y-especificacion.md](./references/formato-y-especificacion.md).

---

## 5. Cómo se Invocan los Agentes Personalizados

Antigravity proporciona **verdadera simetría de ejecución**: un agente puede configurarse para actuar como agente principal, subagente, o ambos.

### 5.1 Invocación como Agente Principal (`mainAgent: true`)
Permite interactuar directamente con el agente especializado en una sesión primaria:
* **Desde la Interfaz Gráfica (Antigravity 2.0 GUI):**
  Selecciona el agente directamente desde el selector desplegable de agentes/modelos.
* **Desde la Consola (Antigravity CLI):**
  ```bash
  agy --agent <nombre-del-agente>
  ```
  *Ejemplo:*
  ```bash
  agy --agent dependency-modernizer
  ```

### 5.2 Invocación como Subagente (`subagent: true`)
Permite que un agente coordinador delegue subtareas de forma asíncrona o directa:
* El agente principal analiza la tarea y, gracias al campo `description` del agente personalizado, determina si delegar la tarea.
* Se ejecuta en un contexto aislado, devolviendo solo los resultados relevantes al agente coordinador.

---

## 6. Procedimiento para Crear un Agente en el Proyecto

Cuando el usuario solicite un nuevo agente:

1. **Definir el alcance:** Determinar rol, herramientas indispensables y modelo adecuado (`flash` para velocidad/costo, `pro` para razonamiento avanzado).
2. **Crear el directorio y archivo:**
   Asegurar que existe el directorio `.agents/agents/` en la raíz del proyecto.
   Crear `.agents/agents/<nombre-agente>.md`.
3. **Escribir el frontmatter:**
   Configurar `name`, `description`, `model`, `tools`, `mainAgent`, `subagent`, `commandExecutionPolicy`.
4. **Escribir las Core Instructions:**
   Definir el rol, flujo de trabajo paso a paso, comandos autorizados de verificación y reglas de respuesta.
5. **Verificar control de versiones:**
   Si el agente es local y privado, asegurar que `.agents/` esté registrado en `.gitignore`.

---

## 7. Ejemplos de Referencia

- [dependency-modernizer.md](./examples/dependency-modernizer.md): Agente de modernización de dependencias y validación de pruebas.
- [code-reviewer.md](./examples/code-reviewer.md): Agente de revisión de código estático y seguridad.
- [test-runner.md](./examples/test-runner.md): Agente autónomo de ejecución y depuración de pruebas.
