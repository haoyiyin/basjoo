#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DOCKER_BIN=${BASJOO_DOCKER_BIN:-docker}

if ! swapon --noheadings --show 2>/dev/null | grep -q '[^[:space:]]'; then
  printf '%s\n' '==> Warning: no swap detected. Next.js builds may fail on 1GB servers.'
  printf '%s\n' '    Add swap first if deploys disconnect SSH:'
  printf '%s\n' '    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile'
fi

printf '%s\n' '==> Preparing .env for zero-config deployment'
BASJOO_PROJECT_ROOT="$SCRIPT_DIR" python3 "$SCRIPT_DIR/backend/env_bootstrap.py"

printf '%s\n' '==> Starting Basjoo production stack'
$DOCKER_BIN compose --project-directory "$SCRIPT_DIR" --profile prod up -d --build

printf '%s\n' ''
printf '%s\n' 'Deployment started.'
printf '%s\n' 'Check status with:'
printf '  %s\n' "$DOCKER_BIN compose --project-directory \"$SCRIPT_DIR\" --profile prod ps"
printf '%s\n' 'Check logs with:'
printf '  %s\n' "$DOCKER_BIN compose --project-directory \"$SCRIPT_DIR\" --profile prod logs -f backend-prod"
printf '  %s\n' "$DOCKER_BIN compose --project-directory \"$SCRIPT_DIR\" --profile prod logs -f nginx"
