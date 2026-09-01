#!/usr/bin/env bash
# Install @duckdb/node-api into a user-level cache (outside any repo) and print the
# absolute import path as the ONLY stdout line. Idempotent: re-runs reuse the install.
set -euo pipefail

log() { printf '[ensure-js-deps] %s\n' "$*" >&2; }

CACHE_DIR="${OMO_DATA_SCIENTIST_CACHE:-$HOME/.cache/omo-data-scientist}"
IMPORT_PATH="$CACHE_DIR/node_modules/@duckdb/node-api/lib/index.js"

if ! command -v bun >/dev/null 2>&1; then
  log "bun is required (https://bun.sh); install it, or use the uv lane instead."
  exit 1
fi

if [ ! -f "$IMPORT_PATH" ]; then
  log "installing @duckdb/node-api into $CACHE_DIR"
  mkdir -p "$CACHE_DIR"
  [ -f "$CACHE_DIR/package.json" ] || printf '{"name":"omo-data-scientist-cache","private":true}\n' > "$CACHE_DIR/package.json"
  (cd "$CACHE_DIR" && bun add @duckdb/node-api 1>&2)
fi

if [ ! -f "$IMPORT_PATH" ]; then
  log "install finished but $IMPORT_PATH is missing; inspect $CACHE_DIR"
  exit 1
fi

printf '%s\n' "$IMPORT_PATH"
