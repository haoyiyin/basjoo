#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DOCKER_BIN=${BASJOO_DOCKER_BIN:-docker}

SUDO=
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO=sudo
fi

if ! swapon --noheadings --show 2>/dev/null | grep -q '[^[:space:]]'; then
  printf '%s\n' '==> No swap detected. Creating 2GB swap file for Next.js build...'
  if [ -f /swapfile ]; then
    printf '%s\n' '==> Existing /swapfile found but not active, re-enabling...'
    ${SUDO} swapon /swapfile 2>/dev/null || true
  else
    ${SUDO} fallocate -l 2G /swapfile 2>/dev/null || ${SUDO} dd if=/dev/zero of=/swapfile bs=1M count=2048
    ${SUDO} chmod 600 /swapfile
    ${SUDO} mkswap /swapfile
    ${SUDO} swapon /swapfile
  fi
  printf '%s\n' '==> Swap enabled. Next.js build should now have enough memory.'
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
