#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BASJOO_PROJECT_ROOT="$SCRIPT_DIR" python3 "$SCRIPT_DIR/backend/env_bootstrap.py"
