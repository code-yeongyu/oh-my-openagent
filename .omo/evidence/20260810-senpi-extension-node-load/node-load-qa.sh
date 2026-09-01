#!/bin/bash
# A/B proof: the published beta.1 extension fails to load under node; the worktree-built fixed
# extension must load cleanly through the SAME senpi runtime and sandbox.
set -uo pipefail
WT="$(cd "$(dirname "$0")/../../.." && pwd)"
SENPI_CLI="$HOME/.local/lib/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/cli.js"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
SB="$(mktemp -d /tmp/omo-ext-qa-XXXXXX)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/agent" "$SB/home"
run_case() {
  local label="$1" ext="$2"
  # provider/model args push senpi through extension load into the auth error instead of hanging on
  # interactive model selection; the load warning must appear (A) or be absent (B) before it.
  HOME="$SB/home" SENPI_CODING_AGENT_DIR="$SB/agent" XDG_DATA_HOME="$SB/xdg" timeout 40 "$NODE_BIN" "$SENPI_CLI" --extension "$ext" -p "say ok" --provider anthropic --model claude-sonnet-4-5 2>&1 | head -6
}
echo "### A. published beta.1 extension (expected: load failure)"
run_case published "$HOME/.local/lib/node_modules/omo-ai/plugin"
echo ""
echo "### B. worktree-built fixed extension (expected: NO load failure)"
run_case fixed "$WT/packages/omo-senpi/plugin"
