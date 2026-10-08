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

Esta habilidad guía la creación, actualización y validación de agentes personalizados en Google Antigravity (2.0 y CLI). Consulta la [documentación oficial](https://www.antigravity.google/docs/subagents/) para compatibilidad con la versión instalada; última revisión documental: 2026-10-07. Distingue las capacidades documentadas de las convenciones de coordinación de este proyecto.

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

Las ubicaciones habituales son:

| Nivel | Ruta de Almacenamiento | Propósito |
| :--- | :--- | :--- |
| **Proyecto / Workspace** | `.agents/agents/<nombre-agente>.md` | Específico del repositorio. Se puede compartir con el equipo o ignorar en `.gitignore`. |
| **Global / Usuario** | `~/.gemini/config/agents/<nombre-agente>.md` | Disponible en todos los proyectos y repositorios de la máquina local. |
| **Plugin** | `plugins/<plugin>/agents/` | Agentes distribuidos en un plugin. |

> [!NOTE]
> También se admite `<nombre-agente>/agent.md`. Antes de editar, revisa si existe una definición del mismo nombre en el proyecto que prevalezca sobre la global. Si una definición debe ser privada, ignora solo su ruta específica o usa `.git/info/exclude` para una exclusión local; conserva las skills y configuraciones compartidas de `.agents/`.

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
model: inherit
mainAgent: false
subagent: true
permissionMode: acceptEdits
commandExecutionPolicy: sandbox
tools:
  - view_file
  - replace_file_content
  - run_command
---

# Core Instructions
Implementa únicamente la tarea delegada, lee las instrucciones locales, preserva cambios preexistentes y entrega archivos modificados, comandos, resultados y bloqueos.
```

El bloque usa valores YAML concretos. Selecciona un solo modelo (`flash`, `pro` o `inherit`) y booleanos reales; no copies alternativas separadas por `|`. Añade `skills` solo después de verificar las rutas instaladas y su pertinencia.

---

## 4. Campos del Frontmatter YAML

| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| **`name`** | `string` | Sí | Identificador único del agente (en minúsculas con guiones, ej. `dependency-modernizer`). |
| **`description`** | `string` | Sí | Describe el propósito del agente. Es fundamental: el agente coordinador la utiliza para saber cuándo delegar tareas en este agente. |
| **`model`** | `string` | No | Modelo que utilizará el agente (`flash`, `pro`, `inherit`, etc.). Por defecto hereda el modelo activo si no se define. |
| **`tools`** | `list<string>` | No | Lista blanca de herramientas permitidas (ej. `view_file`, `replace_file_content`, `run_command`, `manage_task`). Reduce el ruido y el consumo de tokens. |
| **`skills`** | `list<string>` | No | Rutas a directorios de skills instaladas. Comprueba cada `SKILL.md` y la resolución en el entorno de destino. |
| **`mainAgent`** | `boolean` | No | Por defecto `true`; declara `false` explícitamente para agentes exclusivos de delegación. |
| **`subagent`** | `boolean` | No | `true` si el agente puede ser invocado dinámicamente como subagente por un coordinador. |
| **`permissionMode`** | `string` | No | Nivel de permisos del agente (ej. `acceptEdits`, `bypassPermissions`). |
| **`commandExecutionPolicy`** | `string` | No | Política de comandos: `off`, `sandbox`, `auto` o `eager`. Conserva `sandbox` como configuración inicial de estos agentes; no amplíes permisos para resolver una skill ausente. |

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
* No hereda el historial de conversación del padre: pasa el objetivo, raíz de trabajo, contrato completo o ruta legible, criterios, propiedad de archivos, cambios preexistentes, skills pertinentes y comandos de verificación en cada delegación.

---

## 5.3 Coordinación paralela y comunicación entre pares

Para una tarea con backend y frontend:

1. El orquestador registra el contrato versionado en un mensaje autocontenido y lo incluye en cada delegación. Si se usa un archivo, asigna un escritor y lo convierte en la única fuente de verdad. Registra criterios, cambios preexistentes y un propietario por archivo, incluidos lockfiles, tipos, configuración y pruebas compartidas.
2. Invoca backend y frontend concurrentemente cuando trabajen contra un contrato estable y archivos disjuntos; usa el esquema real de `invoke_subagent`, agrupando en una llamada si lo admite. Si hay worktrees, asigna quién integra sus cambios antes de QA.
3. Permite comunicación directa mediante `send_message` para dudas de integración, propuestas de contrato y bloqueos.
4. Registra cambios de contrato, pide confirmación a los consumidores afectados e invalida sus resultados anteriores. Resuelve decisiones locales reversibles con las convenciones existentes; pide aclaración por decisiones materiales pendientes, no por detalles de implementación.
5. Frontend conecta y prueba el backend real antes de `READY`; backend entrega firmas, errores y datos aislados. Los mocks de pruebas pueden permanecer, pero no sustituir el flujo integrado entregado. Invoca QA solo cuando todos los implementadores requeridos estén `READY`; ante `BLOCKED`, resuelve la dependencia y continúa trabajo independiente. Estos son estados del protocolo, no estados nativos del proceso.
6. Ejecuta correcciones en paralelo únicamente con archivos disjuntos y contrato estable; QA repite fallos y regresión afectada, ampliando cuando haya impacto transversal, cambios de contrato o puertas obligatorias. Conserva evidencia vigente para todos los criterios.
7. QA entrega `APROBADO` solo con todos los criterios requeridos en PASS; `REQUIERE CORRECCIONES` si hay FAIL; `BLOQUEADO POR ENTORNO` si no hay FAIL y faltan verificaciones requeridas por el entorno. Los dos últimos son entregas incompletas.

El orquestador coordina decisiones y puertas de calidad, pero no debe retransmitir cada mensaje operativo entre agentes.

---

## 6. Procedimiento para Crear un Agente en el Proyecto

Cuando el usuario solicite un nuevo agente:

1. **Definir el alcance:** Determinar rol, herramientas indispensables y modelo adecuado. Al actualizar agentes, conserva inicialmente sus modelos y evalúa cambios con evidencia de tiempo y retrabajo.
2. **Crear el directorio y archivo:**
   Asegurar que existe el directorio `.agents/agents/` en la raíz del proyecto.
   Crear `.agents/agents/<nombre-agente>.md`.
3. **Escribir el frontmatter:**
   Configurar `name`, `description`, `model`, `tools`, `mainAgent`, `subagent`, `commandExecutionPolicy`.
4. **Escribir las Core Instructions:**
   Definir el rol, propiedad de archivos, flujo paralelo o secuencial, protocolo de comunicación, comandos autorizados de verificación, handoff y criterio de finalización.
   Selecciona skills instaladas según la sección siguiente e incluye cuándo leer cada SKILL.md. Una skill no amplía permisos ni autoriza trabajo externo a la tarea.
5. **Verificar control de versiones:**
   Conserva modificaciones preexistentes y limita exclusiones a los archivos privados correspondientes. Actualiza definiciones locales que oculten las globales si forman parte del alcance autorizado.
6. **Validar:** Ejecuta la validación estática y la prueba de invocación descritas abajo; informa por separado lo que no pudo verificarse.

### Selección de skills instaladas

Inspecciona `~/.gemini/config/skills/`, las skills del proyecto y las rutas declaradas por Antigravity. En instalaciones anteriores pueden existir `~/.gemini/skills/` y `~/.gemini/antigravity/skills/`; su presencia no demuestra que el descubrimiento automático esté activo. Lee cada skill seleccionada antes de asignarla y comprueba sus recursos, herramientas y compatibilidad con el rol.

- Frontend: UI/UX para interfaces; navegador para E2E; corrección o refactorización solo cuando la tarea lo requiera.
- Backend: diagnóstico, corrección, refactorización y migraciones según el tipo de cambio.
- QA: verificación, navegador, revisión UI y diagnóstico; excluye las ramas que escriben producto o publican resultados externos.
- Orquestador: diagnóstico para triage y verificación para el cierre; crear agentes no es su tarea habitual de desarrollo.

En configuraciones globales de esta máquina, usa rutas absolutas comprobadas y ordénale al agente leer el SKILL.md correspondiente. En configuraciones compartidas, usa rutas portables y documenta su base de resolución. Declarar una skill no prueba que se haya ejecutado: exige nombre, aplicación y limitaciones en el handoff. Mantén la carga condicional; no leas todas las skills para cada tarea.

### Validación y prueba mínima

Ejecuta con un Python que tenga PyYAML instalado:

```bash
python3 scripts/validate_agents.py --customization-root /home/vivaceash/.gemini/config /home/vivaceash/.gemini/config/agents
```

Resuelve el script desde el directorio de esta skill. Valida tipos YAML, nombres, roles, duplicados por directorio y rutas de skills. Para rutas relativas, proporciona la raíz de customización efectiva. Si dispones de un catálogo real de herramientas de la sesión (un nombre por línea), añade `--tools-file /ruta/catalogo.txt`; sin él no se afirma compatibilidad de herramientas. La documentación advierte que nombres de herramientas incorrectos pueden bloquear la ejecución.

Después, en una sesión nueva de Antigravity y un workspace temporal, verifica que cada agente se descubre. Delega una tarea de solo lectura: informar su rol, leer una skill aplicable desde su SKILL.md, identificar una instrucción de ella y devolver un handoff sin editar. Comprueba también el envío de un mensaje entre agentes. Inspecciona llamadas/resultados, no solo la afirmación final. Si no está disponible el runtime, marca esta prueba NO EJECUTADA y no presentes la validación estática como prueba de carga.

---

## 7. Ejemplos de Referencia

- [dependency-modernizer.md](./examples/dependency-modernizer.md): Agente de modernización de dependencias y validación de pruebas.
- [code-reviewer.md](./examples/code-reviewer.md): Agente de revisión de código estático y seguridad.
- [test-runner.md](./examples/test-runner.md): Agente autónomo de ejecución y depuración de pruebas.
