#!/usr/bin/env bash
# Live-surface driver for issue #6233.
#
# Drives the REAL user-facing `boulder` CLI (packages/omo-opencode/src/cli/index.ts)
# against a throwaway project directory, with no build step and no network.
#
# It builds two boulder works:
#   work-blocked : a plan whose EVERY task is `- [~]` (the marker the boulder
#                  continuation directive MANDATES for user-blocked tasks)
#   work-mixed   : a plan mixing `- [x]`, `- [~]` and `- [ ]`
#
# Run it once on unmodified upstream/dev and once with the fix applied and diff
# the two outputs.
#
# usage: bash live-driver.sh <output-file>
set -uo pipefail

OUT="${1:?usage: live-driver.sh <output-file>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/omo-6233-XXXXXX")"
trap 'rm -rf "$PROJECT"' EXIT

mkdir -p "$PROJECT/.omo/plans"

cat > "$PROJECT/.omo/plans/blocked-plan.md" <<'PLAN'
# Blocked Plan

## Todos
- [~] 1. Blocked on a decision only the user can make

## Final verification wave
- [~] F1. Blocked on unavailable credentials
PLAN

cat > "$PROJECT/.omo/plans/mixed-plan.md" <<'PLAN'
# Mixed Plan

## Todos
- [x] 1. Shipped
- [~] 2. Blocked on a decision only the user can make
- [ ] 3. Still actionable
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
    },
    "work-mixed": {
      "work_id": "work-mixed",
      "active_plan": ".omo/plans/mixed-plan.md",
      "plan_name": "mixed-plan",
      "status": "active",
      "started_at": "2026-07-27T00:00:00.000Z",
      "ended_at": "2026-07-27T00:10:00.000Z",
      "session_ids": ["ses_mixed"]
    }
  }
}
STATE

{
  echo "### live-surface capture for issue #6233"
  echo "### surface: real boulder CLI -> bun packages/omo-opencode/src/cli/index.ts boulder"
  echo "### repo:    $REPO"
  echo "### plan-checklist.ts diff vs upstream/dev at capture time:"
  git -C "$REPO" diff --stat upstream/dev -- packages/boulder-state/src/plan-checklist.ts
  echo "### (empty above == unmodified base; non-empty == fix applied)"
  echo
  echo "--- plan: blocked-plan.md (every task user-blocked, per the mandated '- [~]') ---"
  cat "$PROJECT/.omo/plans/blocked-plan.md"
  echo
  echo "--- plan: mixed-plan.md ---"
  cat "$PROJECT/.omo/plans/mixed-plan.md"
  echo
  echo "=== \$ omo boulder --json ==="
} > "$OUT"

( cd "$REPO" && bun packages/omo-opencode/src/cli/index.ts boulder --directory "$PROJECT" --json ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

{
  echo
  echo "=== \$ omo boulder   (human-readable text surface) ==="
} >> "$OUT"
( cd "$REPO" && bun packages/omo-opencode/src/cli/index.ts boulder --directory "$PROJECT" ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

echo "wrote $OUT"
