#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DOCKER_BIN=${BASJOO_DOCKER_BIN:-docker}

SUDO=
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO=sudo
fi

# /proc/swaps exists on every Linux and BusyBox swapon has no --show flag.
has_swap() {
  [ -r /proc/swaps ] && [ "$(wc -l < /proc/swaps)" -gt 1 ]
}

# Swap is an optimisation for the Next.js build, never a requirement: on hosts
# where swapon is not permitted (containers, restricted VMs) the deploy must still
# proceed.
ensure_swap() {
  if ! has_swap; then
    printf '%s\n' '==> No swap detected. Creating 2GB swap file for the frontend build...' || true
    if [ -f /swapfile ]; then
      printf '%s\n' '==> Existing /swapfile found but not active, re-enabling...' || true
      if ! ${SUDO} swapon /swapfile 2>/dev/null; then
        printf '%s\n' '==> Re-enabling failed, recreating /swapfile...' || true
        ${SUDO} rm -f /swapfile || true
        ${SUDO} touch /swapfile 2>/dev/null || true
        ${SUDO} chattr +C /swapfile 2>/dev/null || true
        ${SUDO} dd if=/dev/zero of=/swapfile bs=1M count=2048 || true
        ${SUDO} chmod 600 /swapfile || true
        ${SUDO} mkswap /swapfile || true
        ${SUDO} swapon /swapfile || true
      fi
    else
      # Disable CoW on Btrfs before allocation (no-op on other filesystems)
      ${SUDO} touch /swapfile 2>/dev/null || true
      ${SUDO} chattr +C /swapfile 2>/dev/null || true
      ${SUDO} dd if=/dev/zero of=/swapfile bs=1M count=2048 || true
      ${SUDO} chmod 600 /swapfile || true
      ${SUDO} mkswap /swapfile || true
      ${SUDO} swapon /swapfile || true
    fi
    if has_swap; then
      printf '%s\n' '==> Swap enabled.'
    else
      printf '%s\n' '==> Swap unavailable (not permitted here); continuing without it.'
    fi
  fi
}

ensure_swap

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
