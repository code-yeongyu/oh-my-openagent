#!/usr/bin/env bash
# Live proof for the #6569 review finding "Preserve the install-time bin override for uninstall".
#
# Drives the REAL local installer into an ISOLATED CODEX_HOME:
#   1. install with a one-shot CODEX_LOCAL_BIN_DIR pointing at a custom directory
#   2. assert the wrappers landed there and the location was recorded
#   3. uninstall WITHOUT that variable, exactly as a user would later
#   4. assert the wrappers in the custom directory are gone
#
# The real ~/.codex is never read or written; the harness asserts that.
#
# usage: live-bindir-driver.sh <label>
set -uo pipefail

LABEL="${1:?usage: live-bindir-driver.sh <label>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

. "$REPO/.agents/skills/codex-qa/scripts/lib/common.sh"

echo "### #6569 live bin-dir proof"
echo "### label: $LABEL"
echo "### surface: real installer (packages/omo-codex/scripts/install-local.mjs) install + uninstall"
echo "### codex: $(codex --version 2>&1 | head -1)"
echo "### repo: $REPO"

cqa_require codex node || exit 1
cqa_guard_real_home
cqa_mk_isolated_home

CUSTOM_BIN="$(mktemp -d "${TMPDIR:-/tmp}/omo-6569-custombin-XXXXXX")"
CQA_TMPDIRS+=("$CUSTOM_BIN")
echo "### isolated CODEX_HOME: $CODEX_HOME"
echo "### custom bin dir:      $CUSTOM_BIN"

fails=0

echo
echo "=== step 1: install with a ONE-SHOT CODEX_LOCAL_BIN_DIR ==="
if CODEX_LOCAL_BIN_DIR="$CUSTOM_BIN" REPO_ROOT="$REPO" \
   node "$REPO/packages/omo-codex/scripts/install-local.mjs" install \
   >"$CQA_HOME_ROOT/install.log" 2>&1; then
  echo "install: OK"
else
  echo "install FAILED; tail:"; tail -25 "$CQA_HOME_ROOT/install.log"
  exit 1
fi

echo
echo "=== step 2: wrappers landed in the custom dir, and the location was recorded ==="
installed_bins="$(ls "$CUSTOM_BIN" 2>/dev/null | tr '\n' ' ')"
echo "bins in custom dir: ${installed_bins:-<none>}"
if [ -z "$installed_bins" ]; then
  echo "FAIL: installer put no bins in the custom dir"; fails=$((fails+1))
fi

manifest="$(find "$CODEX_HOME/plugins/cache/sisyphuslabs/omo" -name '.installed-bin-dir.json' 2>/dev/null | head -1)"
if [ -n "$manifest" ]; then
  echo "recorded bin dir manifest: $manifest"
  echo "  contents: $(tr -d '\n ' < "$manifest")"
else
  echo "NOTE: no .installed-bin-dir.json recorded (expected on the pre-fix build)"
fi

echo
echo "=== step 3: uninstall WITHOUT CODEX_LOCAL_BIN_DIR (the reported scenario) ==="
# `install-local.mjs uninstall` is a pass-through that spawns the PUBLISHED omo CLI via npx,
# so driving it would test the released build instead of this worktree. Invoke the CLI from
# source, which is the same command surface a user gets from `omo cleanup --platform=codex`.
PROJECT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/omo-6569-project-XXXXXX")"
CQA_TMPDIRS+=("$PROJECT_DIR")
env -u CODEX_LOCAL_BIN_DIR \
  bun "$REPO/packages/omo-opencode/src/cli/index.ts" cleanup \
  --platform=codex --project "$PROJECT_DIR" \
  >"$CQA_HOME_ROOT/uninstall.log" 2>&1
echo "uninstall exit: $?"
tail -8 "$CQA_HOME_ROOT/uninstall.log"

echo
echo "=== step 4: did the wrappers in the custom dir get removed? ==="
leftover="$(ls "$CUSTOM_BIN" 2>/dev/null | tr '\n' ' ')"
if [ -z "$leftover" ]; then
  echo "PASS: custom bin dir is empty after uninstall"
else
  echo "STRANDED in custom bin dir: $leftover"
  fails=$((fails+1))
fi

echo
cqa_assert_real_home_unchanged || fails=$((fails+1))

echo
echo "RESULT($LABEL): fails=$fails"
exit $fails
