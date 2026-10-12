#!/usr/bin/env bash
# Instalador Linux de S.G.R.S.
set -euo pipefail

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
PROJECT_DIR="$(cd -P "$(dirname -- "$SOURCE")" >/dev/null 2>&1 && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[SGRS] ERROR: se requiere Python 3.11 o superior." >&2
    exit 1
fi

cd -- "$PROJECT_DIR"
exec python3 run.py install "$@"
