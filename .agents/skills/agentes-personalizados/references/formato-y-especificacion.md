# Especificación Técnica y Formato de Agentes Personalizados

Este documento detalla la especificación técnica de los Agentes Personalizados (Custom Agents) en Google Antigravity.

---

## 1. Ciclo de Vida y Descubrimiento

1. **Ubicaciones de Descubrimiento:**
   - **Nivel de Proyecto (Workspace):** `.agents/agents/*.md`
     - Antigravity busca en la raíz del repositorio local.
     - Permite definir asistentes compartidos por el equipo (al comitear) o herramientas locales de trabajo (si `.agents/` está en `.gitignore`).
   - **Nivel Global del Usuario:** `~/.gemini/config/agents/*.md`
     - Disponible para todos los proyectos abiertos por el usuario.

2. **Prioridad y Sobrescritura:**
   - Si un agente con el mismo `name` existe tanto en el proyecto como a nivel global, el del **proyecto (`.agents/agents/`)** toma precedencia sobre el global.

---

## 2. Esquema del Frontmatter YAML

Cada archivo debe comenzar obligatoriamente con un bloque YAML delimitado por `---`.

### Propiedades:

#### `name` (string, obligatorio)
- Identificador kebab-case único para el agente.
- Solo caracteres alfanuméricos y guiones (`[a-z0-9-]`).
- *Ejemplo:* `dependency-modernizer`, `security-auditor`.

#### `description` (string, obligatorio)
- Texto descriptivo legible por humanos y por otros modelos de IA.
- Es utilizado por el agente coordinador para la selección y enrutamiento dinámico en subagentes.
- *Ejemplo:* `"Ayuda a actualizar paquetes de software locales y verifica que la suite de pruebas del proyecto pase sin errores."`

#### `model` (string, opcional)
- Especifica el modelo que debe ejecutar este agente.
- Opciones habituales:
  - `flash`: Rápido, económico, ideal para tareas directas, refactorizaciones sencillas o comandos de prueba.
  - `pro`: Máxima capacidad de razonamiento, ideal para arquitectura y debugging complejo.
  - `inherit`: Hereda el modelo configurado en la sesión padre.

#### `mainAgent` (boolean, opcional, por defecto: false)
- Si es `true`, el agente se expone en la interfaz principal de Antigravity (menú desplegable de agentes en Antigravity 2.0 y parámetro `--agent` en CLI).

#### `subagent` (boolean, opcional, por defecto: true)
- Si es `true`, el agente puede ser llamado como herramienta por un agente coordinador para delegación de tareas.

#### `tools` (lista de strings, opcional)
- Define la lista blanca explícita de herramientas a las que el agente tiene acceso.
- Herramientas habituales:
  - `view_file`: Inspección y lectura de archivos.
  - `replace_file_content`: Edición de archivos existentes.
  - `write_to_file`: Creación de archivos.
  - `run_command`: Ejecución de comandos en la terminal.
  - `manage_task`: Control de tareas en segundo plano.
  - `grep_search`: Búsqueda de expresiones con ripgrep.
  - `find_by_name`: Búsqueda de archivos en el árbol de directorios.
  - `read_url_content`: Obtención de documentación externa.

#### `skills` (lista de strings, opcional)
- Rutas relativas a habilidades accesibles para este agente.
- *Ejemplo:*
  ```yaml
  skills:
    - skills/package-upgrade-rules
    - skills/agentes-personalizados
  ```

#### `permissionMode` (string, opcional)
- Control de permisos de interacción con el sistema:
  - `acceptEdits`: Acepta ediciones en archivos con confirmación mínima.
  - `bypassPermissions`: Omite confirmaciones interactivas en entornos seguros.

#### `commandExecutionPolicy` (string, opcional)
- Control de políticas de ejecución de comandos por terminal:
  - `auto`: Ejecuta comandos autónomamente en segundo plano (pruebas, compilación, linters), pero mantiene bloqueadas y bajo confirmación manual acciones de alto riesgo (como eliminación de archivos o comandos destructivos).

---

## 3. Cuerpo en Markdown (System Instructions)

Todo el contenido que sigue al segundo delimitador `---` se compila como el **System Prompt** inicial del agente. Debe incluir:
- **Rol y Objetivos:** Qué representa el agente y cuál es su meta principal.
- **Protocolo de Acción:** Pasos que debe seguir cronológicamente.
- **Comandos de Verificación:** Qué pruebas o linters debe correr antes de dar una tarea por finalizada.
- **Restricciones y Buenas Prácticas:** Qué cosas NO debe hacer.
