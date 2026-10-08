# Especificación Técnica y Formato de Agentes Personalizados

Referencia de configuración de agentes personalizados. Fuente: [documentación oficial](https://www.antigravity.google/docs/subagents/), consultada el 2026-10-07. Confirma compatibilidad con el runtime instalado; las convenciones de coordinación del proyecto se documentan en SKILL.md.

---

## 1. Ciclo de Vida y Descubrimiento

1. **Ubicaciones de Descubrimiento:**
   - **Nivel de Proyecto (Workspace):** `.agents/agents/*.md`
     - Antigravity busca en la raíz del repositorio local.
     - Permite compartir asistentes o excluir solo los archivos privados correspondientes del control de versiones.
   - **Nivel Global del Usuario:** `~/.gemini/config/agents/*.md`
     - Disponible para todos los proyectos abiertos por el usuario.
   - También se admite `<nombre>/agent.md` y agentes distribuidos en `plugins/<plugin>/agents/`.

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

#### `mainAgent` (boolean, opcional, por defecto: true)
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
  - `send_message`: Comunicación dirigida entre agentes cuando se conoce su ID.

#### `skills` (lista de strings, opcional)
- Rutas a directorios con SKILL.md. Verifica su existencia y la resolución en la sesión destino. Las configuraciones globales de esta máquina usan rutas absolutas y lectura explícita del SKILL.md; una ruta relativa requiere conocer su raíz de customización. La validación del sistema de archivos no demuestra carga en el runtime.
- *Ejemplo:*
  ```yaml
  skills:
    - skills/package-upgrade-rules
  ```

#### `permissionMode` (string, opcional)
- Control de permisos de interacción con el sistema:
  - `acceptEdits`: Acepta ediciones en archivos con confirmación mínima.
  - `bypassPermissions`: Omite confirmaciones interactivas en entornos seguros.

#### `commandExecutionPolicy` (string, opcional)
- Control de políticas de ejecución de comandos por terminal:
  - `off`: No permite ejecución automática de comandos.
  - `sandbox`: Ejecuta comandos dentro del sandbox del proyecto.
  - `auto`: Ejecuta comandos autónomamente para pruebas, compilación y linters.
  - `eager`: Ejecuta comandos con la máxima autonomía disponible; úsalo solo en agentes de implementación confiables.

Para estos agentes, conserva `sandbox` inicialmente. Las instrucciones del cuerpo no sustituyen los límites de herramientas ni de permisos. En particular, run_command puede escribir archivos aunque falten herramientas de edición: QA requiere una regla explícita de solo lectura y comprobación de efectos de los comandos.

#### `mcpServers` y `plugins` (opcionales)

La documentación admite `mcpServers` como lista de objetos y `plugins` como lista de cadenas. Úsalos solo si el rol necesita esas capacidades y se verificó su configuración; no añadas dependencias por defecto.

---

## 3. Cuerpo en Markdown (System Instructions)

Todo el contenido que sigue al segundo delimitador `---` se compila como el **System Prompt** inicial del agente. Debe incluir:
- **Rol y Objetivos:** Qué representa el agente y cuál es su meta principal.
- **Protocolo de Acción:** Pasos que debe seguir cronológicamente.
- **Comandos de Verificación:** Qué pruebas o linters debe correr antes de dar una tarea por finalizada.
- **Restricciones y Buenas Prácticas:** Qué cosas NO debe hacer.

## 4. Coordinación paralela y comunicación

Cuando una tarea requiere varias especialidades, el agente coordinador debe:

Aplicar el protocolo de [SKILL.md, sección 5.3](../SKILL.md#53-coordinación-paralela-y-comunicación-entre-pares). Los subagentes comienzan sin el historial del padre; cada delegación necesita contexto autocontenido o referencias legibles.

Los estados nativos documentados son Running, Idle y Killed. READY y BLOCKED son etiquetas de nuestro protocolo: un proceso Idle puede haber terminado con un bloqueo. Conserva los IDs reales para mensajería y reactivación; verifica los nombres y argumentos de herramientas contra el esquema disponible, sin inventarlos a partir de ejemplos.

El coordinador conserva la autoridad sobre alcance, conflictos, cambios de contrato y aprobación final. La comunicación directa entre pares no reemplaza esas puertas.
