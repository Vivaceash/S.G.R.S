#!/usr/bin/env bash
# ==============================================================================
# S.G.R.S. - Sistema de Gestión de Redes y Seguridad
# Script de inicio y control rápido para terminal
# ==============================================================================

PROJECT_DIR="/home/vivaceash/Projects/SGRS"

if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "\033[1;31m[ERROR]\033[0m No se encontró el directorio del proyecto en $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR"

# Seleccionar el intérprete de Python del entorno virtual
if [ -f "$PROJECT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
elif [ -f "$PROJECT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_DIR/venv/bin/python"
else
    PYTHON_BIN="$(which python3)"
fi

# Acción por defecto: iniciar los servicios si no se especifica parámetro
ACTION="${1:-start}"

case "$ACTION" in
    start|iniciar)
        "$PYTHON_BIN" run.py start
        ;;
    stop|detener|down)
        "$PYTHON_BIN" run.py stop
        ;;
    status|estado|ps)
        "$PYTHON_BIN" run.py status
        ;;
    restart|reiniciar)
        "$PYTHON_BIN" run.py restart
        ;;
    logs|log)
        "$PYTHON_BIN" run.py logs
        ;;
    open|abrir)
        if command -v xdg-open &>/dev/null; then
            xdg-open "http://localhost:3000" &>/dev/null &
        fi
        ;;
    *)
        "$PYTHON_BIN" run.py "$@"
        ;;
esac
