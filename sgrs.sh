#!/usr/bin/env bash
# ==============================================================================
# S.G.R.S. - Sistema de Gestión de Redes y Seguridad
# Script de inicio y control rápido para terminal
# ==============================================================================

set -euo pipefail

# Resolver también los enlaces ~/.local/bin/SGRS y ~/.local/bin/sgrs.
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
    SOURCE_DIR="$(cd -P "$(dirname -- "$SOURCE")" >/dev/null 2>&1 && pwd)"
    LINK_TARGET="$(readlink -- "$SOURCE")"
    if [[ "$LINK_TARGET" != /* ]]; then
        SOURCE="$SOURCE_DIR/$LINK_TARGET"
    else
        SOURCE="$LINK_TARGET"
    fi
done
SCRIPT_PATH="$(cd -P "$(dirname -- "$SOURCE")" >/dev/null 2>&1 && pwd)/$(basename -- "$SOURCE")"
PROJECT_DIR="$(dirname -- "$SCRIPT_PATH")"

if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "\033[1;31m[ERROR]\033[0m No se encontró el directorio del proyecto en $PROJECT_DIR"
    exit 1
fi

cd -- "$PROJECT_DIR"

# Seleccionar el intérprete de Python del entorno virtual
if [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
elif [ -x "$PROJECT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_DIR/venv/bin/python"
else
    PYTHON_BIN="$(command -v python3)"
fi

if [ -z "${PYTHON_BIN:-}" ] || [ ! -x "$PYTHON_BIN" ]; then
    echo -e "\033[1;31m[ERROR]\033[0m No se encontró un intérprete Python ejecutable."
    echo "Instala Python 3.11+ y ejecuta: $PROJECT_DIR/install.sh"
    exit 1
fi

# Acción por defecto: iniciar los servicios si no se especifica parámetro
ACTION="${1:-start}"
if [ "$#" -gt 0 ]; then
    shift
fi

case "$ACTION" in
    install|setup|init)
        exec "$PYTHON_BIN" run.py "$ACTION" "$@"
        ;;
    start|iniciar)
        exec "$PYTHON_BIN" run.py start "$@"
        ;;
    stop|detener|down)
        exec "$PYTHON_BIN" run.py stop "$@"
        ;;
    status|estado|ps)
        exec "$PYTHON_BIN" run.py status "$@"
        ;;
    restart|reiniciar)
        exec "$PYTHON_BIN" run.py restart "$@"
        ;;
    logs|log)
        exec "$PYTHON_BIN" run.py logs "$@"
        ;;
    open|abrir)
        exec "$PYTHON_BIN" run.py open "$@"
        ;;
    *)
        exec "$PYTHON_BIN" run.py "$ACTION" "$@"
        ;;
esac
