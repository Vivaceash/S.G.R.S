# Revisión de dependencias y runtimes — 23 de octubre de 2026

## Alcance y resultado

Se revisaron los manifiestos del gateway Python, las APIs Forti, Omni e Inventarios,
el Dashboard React, sus bloqueos, el instalador y los workflows de GitHub Actions.
No se encontraron fuentes PHP, manifiestos Composer ni un ejecutable `php` en PATH.
Esto no certifica el software instalado en los dispositivos FortiGate/OmniVista ni
en otros servidores externos.

Las auditorías finales de npm y los cuatro bloqueos Python no encontraron
vulnerabilidades conocidas. `npm outdated` y `pip list --outdated` no reportaron
paquetes pendientes al cierre. Este resultado es una comprobación de las bases
consultadas en esta fecha, no una garantía frente a vulnerabilidades desconocidas.

## Hallazgos corregidos

| Componente | Antes | Después | Evidencia |
| --- | --- | --- | --- |
| Node.js local | 24.20.0 | 24.22.1 LTS | Aviso oficial del 21 de octubre; descarga con SHA256 verificado |
| Python de `.venv` | 3.14.8 | 3.14.9 | Versión corregida de la misma rama; OpenSSL 3.5.9 |
| npm local | 11.19.0 | 12.2.1 | Última versión consultada en npm |
| pip del proyecto | 26.2.1 | 26.2.2 | Última versión consultada en PyPI |
| Vite | 6.4.3 | 8.3.5 | Cinco avisos en `npm audit`, severidad máxima alta |
| source-map-js | 1.2.1 | Árbol corregido | GHSA-68fv-2mgg-jv7q; auditoría final limpia |
| certifi | 2026.7.22 | 2026.10.23 | PYSEC-2026-4320 |
| urllib3 | 2.7.0 | 2.8.0 | PYSEC-2026-4177, PYSEC-2026-4176, PYSEC-2026-4175 |

También se actualizaron FastAPI a 0.161.1, Uvicorn a 0.54.0, Pydantic a 2.14.1,
Pydantic Settings a 2.16.1, AnyIO a 4.15.1, Scalar FastAPI a 1.9.1 y las
dependencias transitivas resueltas. El frontend incluye React/React DOM 19.3.1,
Lucide 1.61.0, Tailwind 4.3.3, plugin React 6.1.2, Playwright 1.64.1 y Axe 4.14.0.
Los números exactos de todo el árbol están en los archivos de bloqueo.

Se conservó la rama Python 3.14 para aplicar el parche sin introducir el salto
adicional a 3.15. El Python del sistema operativo (`/usr/bin/python3`) continúa en
3.14.8; SGRS utiliza `.venv/bin/python`, vinculado al Python 3.14.9 administrado
en `~/.local/share/uv/python`. No se reemplazó el intérprete del sistema.

## Instalación reproducible y CI

- Nuevo `requirements.lock` raíz y regeneración de los tres bloqueos de APIs,
  con versiones exactas y hashes SHA256.
- Manifiestos directos de las APIs alineados con los del gateway.
- El instalador usa `--require-hashes` y falla si falta el bloqueo.
- `.python-version`, `.nvmrc`, `engines` y `packageManager` registran las versiones
  verificadas. Estos archivos no actualizan por sí solos otros servidores.
- CI configura Python/Node explícitamente, instala desde bloqueos, instala Chromium
  y audita Python y npm. Las acciones actualizadas están fijadas por SHA.
- Se regeneró `Dashboard/dist` con el código local existente y las dependencias nuevas.

Para una instalación existente, con los runtimes indicados ya instalados:

```bash
.venv/bin/python -m pip install --upgrade pip==26.2.2
.venv/bin/python -m pip install --require-hashes -r requirements.lock
npm ci --prefix Dashboard
npm run build --prefix Dashboard
.venv/bin/python run.py restart
```

El arranque solo instala dependencias cuando faltan; por eso la actualización de
un entorno existente requiere ejecutar explícitamente la instalación del bloqueo.
Al consultar el estado local, los cuatro servicios registrados estaban inactivos.
No se verificaron conexiones reales a proveedores ni un despliegue remoto.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `pip check` | Sin incompatibilidades |
| `pip-audit --require-hashes` en los cuatro bloqueos | Sin vulnerabilidades conocidas |
| `npm audit` incluyendo desarrollo | 0 vulnerabilidades |
| Suite general Python con 3.14.9 | 301 pruebas aprobadas |
| API Forti | 84 pruebas aprobadas |
| API Omni | 57 pruebas aprobadas |
| API Inventarios | 39 pruebas aprobadas |
| `npm test` con Node 24.22.1 y Chromium actualizado | 74 pruebas aprobadas |
| Compilación Python y `git diff --check` | Correctos |
| Build Vite | Correcto; aviso de tamaño de bundle superior a 500 kB |

Se adaptó la prueba del instalador para exigir hashes y la prueba de búsqueda del
Dashboard para esperar el contenido renderizado, sin un reloj simulado innecesario;
la limpieza se comprueba mediante el botón accesible de la interfaz.

**El recorrido ampliado `npm run test:browser` no pasó completo.** Pudo renderizar
cinco secciones y verificar que el modo demo no consulta APIs reales, pero:

- Busca el botón «Página siguiente», mientras `DataTable` usa desplazamiento infinito
  por defecto. Es necesario actualizar ese recorrido a la navegación actual.
- Axe detectó contraste 3.95:1, inferior a 4.5:1, en `.ip-kpi-all > .ip-kpi-foot`
  y `.audit-kpi-brand > small` (disponibilidad y bitácora).

Estos hallazgos permanecen abiertos y no permiten declarar una validación integral
de interfaz. El reporte y capturas de esta ejecución están temporalmente en
`/tmp/sgrs-security-browser`; no contienen consultas a proveedores reales.

## Reversión

No hubo migraciones de esquema. Se preservaron los cambios locales previos.
La instantánea inicial del diff está en `/tmp/sgrs-before-security.patch` y el
inventario anterior de Python en `/tmp/sgrs-python-before.txt`. El binario Node
anterior se conservó en `/tmp/sgrs-node-before-security` y la configuración del
entorno Python en `/tmp/sgrs-pyvenv-before.cfg`.

Una reversión debe restaurar conjuntamente los manifiestos/bloqueos anteriores,
reinstalar los paquetes correspondientes y recompilar el frontend, sin descartar
los cambios funcionales locales. Reintroduciría los avisos de seguridad señalados;
esos respaldos son temporales y no sustituyen un respaldo de despliegue.

## Fuentes

- [Aviso oficial Node.js del 21 de octubre](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
- [Versiones oficiales de Python](https://www.python.org/downloads/).
- [Avisos oficiales PHP del 21 y 23 de octubre](https://www.php.net/archive/2026.php).
  PHP publicó correcciones y una recomendación adicional para determinados usos
  de sesiones; no se identificó PHP como dependencia de este repositorio.
- Resultados directos de npm audit y pip-audit/PyPI consultados durante esta revisión.
