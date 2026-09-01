#!/usr/bin/env bash
# Live-surface driver for issue #6376.
#
# The bug only manifests in the BUILT CLI bundle: bundlers inline
# packages/shared-skills/index.mjs, so `import.meta.url` becomes the consuming
# bundle's own URL. dist/index.js sits beside dist/skills and resolves correctly,
# but dist/cli/index.js and dist/cli-node/index.js sit one level below it.
#
# This drives the real built output:
#   1. asset asymmetry           - dist/skills has the asset, dist/cli/skills does not
#   2. inlined literals          - what the shipped bundle actually contains
#   3. resolution at the real location - a probe copy of the SHIPPED index.mjs placed in
#      the exact directory each bundle lives in, so its import.meta.url reproduces the
#      bundle's own resolution against the real built assets
#   4. real omo CLI doctor       - corroborating user-facing surface
#
# Everything runs against an isolated sandbox HOME so the real host state is untouched.
#
# usage: bash live-driver.sh <output-file>
set -uo pipefail

OUT="${1:?usage: live-driver.sh <output-file>}"
# OMO_REPO_ROOT lets a caller that copies this script elsewhere (for example to strip CRLF)
# still resolve the repository; BASH_SOURCE would otherwise point at the copy's directory.
REPO="${OMO_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6376-XXXXXX")"
trap 'rm -rf "$SBX"; rm -f "$REPO/dist/cli/omo-6376-probe.mjs" "$REPO/dist/cli-node/omo-6376-probe.mjs" "$REPO/dist/omo-6376-probe.mjs"' EXIT

# Any probe that fails flips this; the script exits non-zero at the end. `set -e` is not
# usable here because the probes are expected to report MISSING on an unfixed base, so
# failures are tracked explicitly instead of aborting.
DRIVER_FAILED=0
fail() { printf 'DRIVER-FAIL: %s\n' "$*" | tee -a "$OUT" >&2; DRIVER_FAILED=1; }

# The bug only exists in BUILT output, so the artifacts are a hard prerequisite rather than
# something to skip silently. Building here is not possible on Windows (the vendored
# lsp-tools-mcp build script starts with `rm -rf`), so they are required explicitly.
REQUIRED_ARTIFACTS="dist/index.js dist/cli/index.js dist/cli-node/index.js dist/skills/ast-grep/install.sh"
MISSING_ARTIFACTS=""
for A in $REQUIRED_ARTIFACTS; do
  [ -e "$REPO/$A" ] || MISSING_ARTIFACTS="$MISSING_ARTIFACTS $A"
done
if [ -n "$MISSING_ARTIFACTS" ]; then
  printf 'DRIVER-FAIL: missing built artifacts:%s\n' "$MISSING_ARTIFACTS" >&2
  printf 'Run `bun run build` first (it emits the omo bundles before the vendored lsp-tools-mcp step).\n' >&2
  exit 2
fi

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
  echo "### live-surface capture for issue #6376"
  echo "### surface: the BUILT omo CLI bundles under dist/"
  echo "### index.mjs diff vs upstream/dev at capture time:"
  git -C "$REPO" diff --stat upstream/dev -- packages/shared-skills/index.mjs
  echo "### (empty above == unmodified base; non-empty == fix applied)"
  echo
  echo "=== 1. asset asymmetry (the precondition of the bug) ==="
  echo "  dist/skills/ast-grep/install.sh          : $([ -f "$REPO/dist/skills/ast-grep/install.sh" ] && echo EXISTS || echo MISSING)"
  echo "  dist/cli/skills/ast-grep/install.sh      : $([ -f "$REPO/dist/cli/skills/ast-grep/install.sh" ] && echo EXISTS || echo MISSING)"
  echo "  dist/cli-node/skills/ast-grep/install.sh : $([ -f "$REPO/dist/cli-node/skills/ast-grep/install.sh" ] && echo EXISTS || echo MISSING)"
  echo
  echo "=== 2. literals inlined into the SHIPPED bundles ==="
  for B in dist/index.js dist/cli/index.js dist/cli-node/index.js; do
    [ -f "$REPO/$B" ] || { echo "  $B : (absent)"; continue; }
    printf '  %-24s sibling "./skills/"=%s  parent "../skills/"=%s\n' "$B" \
      "$(grep -c 'new URL("\./skills/"' "$REPO/$B" 2>/dev/null)" \
      "$(grep -c 'new URL("\.\./skills/"' "$REPO/$B" 2>/dev/null)"
  done
  echo
  echo "=== 3. resolution AT each real bundle location ==="
} > "$OUT"

for D in dist dist/cli dist/cli-node; do
  [ -d "$REPO/$D" ] || { fail "expected bundle directory $D is absent"; continue; }
  cp "$REPO/packages/shared-skills/index.mjs" "$REPO/$D/omo-6376-probe.mjs"
  ( cd "$REPO" && node -e '
    const { pathToFileURL } = require("node:url");
    const { existsSync } = require("node:fs");
    const { join } = require("node:path");
    const dir = process.argv[1];
    import(pathToFileURL(join(dir, "omo-6376-probe.mjs")).href).then((m) => {
      const p = m.sharedSkillsRootPath();
      const asset = join(p, "ast-grep", "install.sh");
      console.log("  bundle dir " + dir.padEnd(14) + " -> " + p);
      console.log("      dir exists            : " + existsSync(p));
      console.log("      ast-grep/install.sh   : " + (existsSync(asset) ? "FOUND" : "MISSING"));
    });
  ' "$D" ) >> "$OUT" 2>&1
  PROBE_EXIT=$?
  # A probe that cannot import or execute prints no MISSING line, so without this a crash
  # would leave the final grep reporting PASS for a bundle that was never exercised.
  [ "$PROBE_EXIT" -eq 0 ] || fail "bundle probe for $D exited $PROBE_EXIT (bundle not exercised)"
  rm -f "$REPO/$D/omo-6376-probe.mjs"
done

{
  echo
  echo "=== 4. real omo CLI in the isolated sandbox ==="
  echo "\$ node dist/cli-node/index.js doctor"
} >> "$OUT"
( cd "$SBX" && node "$REPO/dist/cli-node/index.js" doctor ) >> "$OUT" 2>&1
DOCTOR_EXIT=$?
echo "EXIT=$DOCTOR_EXIT" >> "$OUT"
# doctor exits 1 whenever it reports findings, so only a crash (>1) is a driver failure.
[ "$DOCTOR_EXIT" -le 1 ] || fail "doctor crashed with exit $DOCTOR_EXIT"

# Assert the thing this PR is about: every shipped bundle must resolve a skills root that
# actually contains the ast-grep asset. Without this the driver reported MISSING and still
# exited 0.
if grep -q 'ast-grep/install.sh   : MISSING' "$OUT"; then
  fail "a shipped bundle resolved a skills root without ast-grep/install.sh"
fi

{
  echo
  echo "=== driver verdict ==="
  echo "  DRIVER_FAILED=$DRIVER_FAILED"
  echo "  RESULT: $([ "$DRIVER_FAILED" -eq 0 ] && echo PASS || echo FAIL)"
} >> "$OUT"

echo "wrote $OUT"
exit "$DRIVER_FAILED"
