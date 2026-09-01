#!/usr/bin/env bash
# Cross-harness teardown for oh-my-openagent dev environments.
#
# Default: remove only regenerable transient artifacts (build-info, OS junk).
# It NEVER touches source, node_modules, dist, or anything outside the repo.
# Pass --deep to also drop build outputs and dependencies for a full reset
# (regenerate with script/agent/setup.sh).
#
# Run directly for synchronous cleanup. Claude Code SessionEnd uses
# cleanup-hook.sh so shutdown cannot cancel this worker mid-traversal.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[cleanup] %s\n' "$*"; }

# Safety guard: refuse to run unless we are at the oh-my-openagent repo root.
if ! grep -q '"oh-my-openagent"' "$REPO_ROOT/package.json" 2>/dev/null; then
  log "ERROR: refusing to run - $REPO_ROOT is not the oh-my-openagent repo root"
  exit 1
fi

deep=0
for arg in "$@"; do
  case "$arg" in
    --deep) deep=1 ;;
    -h | --help)
      log "usage: cleanup.sh [--deep]   (--deep also removes dist + node_modules)"
      exit 0
      ;;
    *)
      log "unknown argument: $arg (try --help)"
      exit 2
      ;;
  esac
done

# Always-safe: regenerable transient files only. Prune heavy ignored trees
# before traversal so short-lived harness shutdown hooks do not get cancelled
# while walking node_modules or git internals.
find "$REPO_ROOT" \
  \( -type d \( -name node_modules -o -name .git \) -prune \) -o \
  \( -type f \( -name '*.tsbuildinfo' -o -name '.DS_Store' \) -exec rm -f {} + \) 2>/dev/null || true
log "removed transient build-info and OS artifacts"

if [ "$deep" -eq 1 ]; then
  log "--deep: removing build outputs and dependencies (rerun script/agent/setup.sh to restore)"
  rm -rf "$REPO_ROOT/dist"
  rm -rf "$REPO_ROOT"/packages/*/dist
  rm -rf "$REPO_ROOT/node_modules"
fi

log "done."
