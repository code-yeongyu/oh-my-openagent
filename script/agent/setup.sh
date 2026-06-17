#!/usr/bin/env bash
# Cross-harness dev-environment bootstrap for oh-my-openagent.
#
# Single source of truth for setting up a working tree so an agent (or human)
# can build and QA the plugin. Wired into Codex App (.codex/setup.sh), Cursor
# (.cursor/environment.json install), Claude Code (.claude/settings.json
# SessionStart), and the devcontainer (postCreateCommand). Idempotent and safe
# to re-run: it skips the (slow) build when dist/index.js already exists unless
# OMO_AGENT_FORCE_BUILD=1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[setup] %s\n' "$*"; }

# Credentials, set once: source the gitignored .env if present so keys are
# never prompted for again on this machine. See .env.example.
if [ -f "$REPO_ROOT/.env" ]; then
  log "loading credentials from .env"
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

# Required toolchain.
missing=0
for tool in bun node git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "ERROR: required tool '$tool' not found on PATH"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  log "install the missing tools and re-run. See CONTRIBUTING.md (Prerequisites)."
  exit 1
fi

# Optional toolchain (non-fatal).
if ! command -v tmux >/dev/null 2>&1; then
  log "WARN: tmux not found - interactive_bash and team-mode will be unavailable"
fi

log "bun $(bun --version) / node $(node --version) / $(git --version)"

# Warn (do not fail) when the local toolchain drifts from the CI-pinned versions.
expected_bun="1.3.12"
expected_node_major="24"
bun_version="$(bun --version 2>/dev/null || echo unknown)"
node_major="$(node --version 2>/dev/null | sed -E 's/^v?([0-9]+).*/\1/')"
[ "$bun_version" = "$expected_bun" ] || log "WARN: Bun $bun_version differs from CI-pinned $expected_bun (see .devcontainer/Dockerfile)"
[ "$node_major" = "$expected_node_major" ] || log "WARN: Node major $node_major differs from CI-pinned $expected_node_major"

# --ignore-scripts: the root package.json 'prepare' runs 'bun run build'; skip it
# here so the explicit, guarded build below stays idempotent.
log "installing dependencies (bun install --ignore-scripts)"
bun install --ignore-scripts

if [ ! -f "$REPO_ROOT/dist/index.js" ] || [ "${OMO_AGENT_FORCE_BUILD:-0}" = "1" ]; then
  log "building plugin (dist/index.js missing or OMO_AGENT_FORCE_BUILD=1)"
  bun run build
else
  log "dist/index.js present - skipping build (set OMO_AGENT_FORCE_BUILD=1 to force a rebuild)"
fi

log "ready. Run 'bun test' to verify, or 'source script/agent/qa-sandbox.sh' for isolated QA."
