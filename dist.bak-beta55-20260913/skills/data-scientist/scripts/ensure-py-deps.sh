#!/usr/bin/env bash
# Install polars + pyarrow for a given Python interpreter into a user-level cache
# (never mutating the interpreter itself) and print the site directory as the ONLY
# stdout line. Idempotent: re-runs reuse the install. arg1 = python executable
# (default: python3); pass the kernel's sys.executable for kernel use.
set -euo pipefail

log() { printf '[ensure-py-deps] %s\n' "$*" >&2; }

PYTHON_BIN="${1:-python3}"

if ! command -v uv >/dev/null 2>&1; then
  log "uv is required (see references/uv-setup.md); install it first."
  exit 1
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1 && [ ! -x "$PYTHON_BIN" ]; then
  log "python executable not found: $PYTHON_BIN"
  exit 1
fi

TAG="$("$PYTHON_BIN" -c 'import sys; print(f"cp{sys.version_info[0]}{sys.version_info[1]}")')" \
  || { log "not a working python interpreter: $PYTHON_BIN"; exit 1; }
CACHE_DIR="${OMO_DATA_SCIENTIST_CACHE:-$HOME/.cache/omo-data-scientist}"
SITE_DIR="$CACHE_DIR/py-$TAG"

if [ ! -d "$SITE_DIR/polars" ] || [ ! -d "$SITE_DIR/pyarrow" ]; then
  log "installing polars + pyarrow for $TAG into $SITE_DIR"
  mkdir -p "$SITE_DIR"
  uv pip install --python "$PYTHON_BIN" --target "$SITE_DIR" polars pyarrow 1>&2
fi

if [ ! -d "$SITE_DIR/polars" ]; then
  log "install finished but $SITE_DIR/polars is missing; inspect $SITE_DIR"
  exit 1
fi

printf '%s\n' "$SITE_DIR"
