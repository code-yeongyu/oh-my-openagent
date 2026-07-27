#!/usr/bin/env bash
# Real-OpenCode harness driver for issue #6233.
#
# The parser fixed here (packages/boulder-state) feeds the OpenCode Atlas
# idle/continuation path, so this drives REAL opencode with the locally built
# plugin loaded, inside a fully isolated sandbox, and additionally runs the real
# `omo boulder` CLI against the same sandbox project.
#
# Isolation: HOME / USERPROFILE / APPDATA / LOCALAPPDATA and every XDG_* are
# redirected into a mktemp sandbox removed on exit, so the real opencode
# database and user config are never read or written.
#
# usage: bash live-driver-opencode.sh <output-file>
set -uo pipefail

OUT="${1:?usage: live-driver-opencode.sh <output-file>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6233-oc-XXXXXX")"
trap 'rm -rf "$SBX"' EXIT

PROJECT="$SBX/project"
mkdir -p "$PROJECT/.opencode" "$PROJECT/.omo/plans" "$SBX/home"

cat > "$PROJECT/.opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO_WIN/dist/index.js"]
}
JSON

# a plan whose remaining work is entirely user-blocked, written with the marker
# BOULDER_CONTINUATION_PROMPT mandates for blocked tasks
cat > "$PROJECT/.omo/plans/blocked-plan.md" <<'PLAN'
# Blocked Plan

## Todos
- [~] 1. Blocked on a decision only the user can make

## Final verification wave
- [~] F1. Blocked on unavailable credentials
PLAN

cat > "$PROJECT/.omo/boulder.json" <<'STATE'
{
  "schema_version": 2,
  "active_work_id": "work-blocked",
  "active_plan": ".omo/plans/blocked-plan.md",
  "plan_name": "blocked-plan",
  "started_at": "2026-07-27T00:00:00.000Z",
  "session_ids": ["ses_blocked"],
  "works": {
    "work-blocked": {
      "work_id": "work-blocked",
      "active_plan": ".omo/plans/blocked-plan.md",
      "plan_name": "blocked-plan",
      "status": "active",
      "started_at": "2026-07-27T00:00:00.000Z",
      "ended_at": "2026-07-27T00:10:00.000Z",
      "session_ids": ["ses_blocked"]
    }
  }
}
STATE

export HOME="$SBX/home"
export USERPROFILE="$SBX/home"
export APPDATA="$SBX/home/AppData/Roaming"
export LOCALAPPDATA="$SBX/home/AppData/Local"
export XDG_DATA_HOME="$SBX/home/.local/share"
export XDG_CONFIG_HOME="$SBX/home/.config"
export XDG_STATE_HOME="$SBX/home/.local/state"
export XDG_CACHE_HOME="$SBX/home/.cache"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
mkdir -p "$APPDATA" "$LOCALAPPDATA" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

{
  echo "### real-OpenCode harness capture for issue #6233"
  echo "### opencode: $(opencode --version 2>&1 | head -1)"
  echo "### plan-checklist.ts diff vs upstream/dev at capture time:"
  git -C "$REPO" diff --stat upstream/dev -- packages/boulder-state/src/plan-checklist.ts
  echo "### (empty above == unmodified base; non-empty == fix applied)"
  echo
  echo "--- the plan under test (every task user-blocked) ---"
  cat "$PROJECT/.omo/plans/blocked-plan.md"
  echo
  echo "=== \$ opencode debug paths   (isolation: all inside the sandbox) ==="
} > "$OUT"
( cd "$PROJECT" && opencode debug paths ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

{
  echo
  echo "=== \$ opencode debug config  -> plugin loads with this change ==="
} >> "$OUT"
( cd "$PROJECT" && opencode debug config ) > "$SBX/config.json" 2>"$SBX/config.err"
echo "EXIT=$?" >> "$OUT"
node -e '
const { readFileSync } = require("node:fs");
const raw = readFileSync(process.argv[1], "utf-8");
let cfg; try { cfg = JSON.parse(raw) } catch { const s = raw.indexOf("{"); cfg = s>=0 ? JSON.parse(raw.slice(s)) : null }
if (!cfg) { console.log("  UNPARSEABLE"); process.exit(0) }
const names = Object.keys(cfg.agent ?? {}).sort();
console.log("  OMO plugin loaded (agent count): " + names.length);
console.log("  agents: " + names.join(", "));
' "$SBX/config.json" >> "$OUT" 2>&1

{
  echo
  echo "=== \$ omo boulder --json   (real CLI, same isolated sandbox) ==="
} >> "$OUT"
( cd "$REPO" && bun packages/omo-opencode/src/cli/index.ts boulder --directory "$PROJECT" --json ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

{
  echo
  echo "=== \$ omo boulder   (text surface) ==="
} >> "$OUT"
( cd "$REPO" && bun packages/omo-opencode/src/cli/index.ts boulder --directory "$PROJECT" ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

echo "wrote $OUT"
