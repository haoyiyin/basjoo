#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WIDGET_DIR="$ROOT_DIR/widget"
SOURCE_BUNDLE="$WIDGET_DIR/dist/basjoo-widget.min.js"
TARGET_BUNDLE="$ROOT_DIR/backend/static/sdk.js"

printf '==> Building widget bundle\n'
npm --prefix "$WIDGET_DIR" run build

if [[ ! -f "$SOURCE_BUNDLE" ]]; then
  printf 'Built widget bundle not found: %s\n' "$SOURCE_BUNDLE" >&2
  exit 1
fi

printf '==> Syncing widget bundle to backend/static/sdk.js\n'
cp "$SOURCE_BUNDLE" "$TARGET_BUNDLE"

if ! cmp -s "$SOURCE_BUNDLE" "$TARGET_BUNDLE"; then
  printf 'Widget sync verification failed: %s does not match %s\n' "$TARGET_BUNDLE" "$SOURCE_BUNDLE" >&2
  exit 1
fi

printf '==> Widget bundle synced successfully\n'
printf 'Source: %s\n' "$SOURCE_BUNDLE"
printf 'Target: %s\n' "$TARGET_BUNDLE"
