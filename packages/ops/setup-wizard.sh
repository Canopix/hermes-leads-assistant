#!/usr/bin/env bash
# setup-wizard.sh — Launcher for the Python setup wizard
# Wraps setup-wizard.py and handles Python dependency installation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/setup-wizard.py"

# Find Python: prefer Hermes venv, fall back to system python3
HERMES_PY="${HOME}/.hermes/hermes-agent/venv/bin/python"
if [[ -x "$HERMES_PY" ]]; then
    PYTHON="$HERMES_PY"
elif command -v python3 &>/dev/null; then
    PYTHON="python3"
else
    echo "Error: Python 3 not found. Install Python 3 first."
    exit 1
fi

# Check if dependencies are installed, offer to install if missing
if ! "$PYTHON" -c "import typer, rich, questionary" 2>/dev/null; then
    echo "Installing Python dependencies for the wizard..."
    "$PYTHON" -m pip install typer rich questionary --quiet 2>/dev/null || {
        echo ""
        echo "Could not install dependencies automatically."
        echo "Please install them manually:"
        echo "  $PYTHON -m pip install typer rich questionary"
        echo ""
        echo "Or if using the Hermes venv:"
        echo "  ~/.hermes/hermes-agent/venv/bin/pip install typer rich questionary"
        exit 1
    }
    echo "Dependencies installed."
    echo ""
fi

exec "$PYTHON" "$PYTHON_SCRIPT" "$@"
