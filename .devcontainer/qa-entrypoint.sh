#!/usr/bin/env bash
# Disposable-container QA entrypoint. Copies the read-only host config mounts
# into writable home dirs so QA runs against a COPY (the host config is never
# written), excluding heavy caches, then exec's the QA command. The container is
# the sandbox and is discarded on exit (docker run --rm), so the host is never
# touched.
set -euo pipefail

excludes=(--exclude=cache/ --exclude=.cache/ --exclude=__pycache__/ --exclude=.ruff_cache/ --exclude=node_modules/ --exclude='*.log')

if [ -d /mnt/host/opencode-config ]; then
  mkdir -p "$HOME/.config/opencode"
  rsync -a "${excludes[@]}" /mnt/host/opencode-config/ "$HOME/.config/opencode/" 2>/dev/null || true
fi
if [ -d /mnt/host/codex ]; then
  mkdir -p "$HOME/.codex"
  rsync -a "${excludes[@]}" /mnt/host/codex/ "$HOME/.codex/" 2>/dev/null || true
fi

exec "$@"
