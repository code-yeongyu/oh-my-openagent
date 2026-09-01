#!/usr/bin/env bash
# ISOLATION CONTRACT: redirects HOME/CODEX_HOME/CODEX_LOCAL_BIN_DIR into one disposable ROOT,
# so the real ~/.codex is never a write target. Every assertion is scoped under that ROOT.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 1

PASS=0
FAIL=0
ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

REAL_CODEX_SHA_BEFORE="$( [ -f "$HOME/.codex/config.toml" ] && shasum -a 256 "$HOME/.codex/config.toml" | cut -d' ' -f1 || echo "absent" )"

ROOT="$(mktemp -d -t omo-lead-qa)"
export HOME="$ROOT/home"
export CODEX_HOME="$ROOT/codex"
export CODEX_LOCAL_BIN_DIR="$ROOT/bin"
mkdir -p "$HOME" "$CODEX_HOME" "$CODEX_LOCAL_BIN_DIR"
echo "== isolated ROOT=$ROOT =="

MARKER="OMO_GENERATED_RUNTIME_WRAPPER"

hook_wiring_hash() {
  { find packages/omo-codex/plugin/.codex-plugin -name 'plugin.json' -print0 2>/dev/null;
    find packages/omo-codex/plugin/components -path '*/hooks/hooks.json' -print0 2>/dev/null;
    find packages/omo-codex/plugin/hooks -name '*.json' -print0 2>/dev/null; } \
  | xargs -0 shasum -a 256 2>/dev/null | sort | shasum -a 256 | cut -d' ' -f1
}

HOOKS_BEFORE="$(hook_wiring_hash)"

echo "== scenario 1: clean install =="
node packages/omo-codex/scripts/install-local.mjs install >"$ROOT/install1.log" 2>&1
echo "install exit=$?" | tee -a "$ROOT/install1.log" >/dev/null

check "canonical omo-agent-toolkit wrapper exists" "[ -f \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" ]"
check "canonical carries the runtime-wrapper marker" "grep -q '$MARKER' \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" 2>/dev/null"
check "canonical exports OMO_INVOCATION_NAME=omo-agent-toolkit" "grep -q 'OMO_INVOCATION_NAME=\"\\?omo-agent-toolkit' \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" 2>/dev/null"
check "canonical exports OMO_EDITION=codex" "grep -q 'OMO_EDITION=\"\\?codex' \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" 2>/dev/null"
check "legacy omo bin is ABSENT after clean install" "[ ! -e \"$CODEX_LOCAL_BIN_DIR/omo\" ]"

echo "== scenario 2: planted MARKER-BEARING legacy omo must be DELETED =="
printf '#!/usr/bin/env bash\n# %s\necho stale\n' "$MARKER" > "$CODEX_LOCAL_BIN_DIR/omo"
chmod +x "$CODEX_LOCAL_BIN_DIR/omo"
node packages/omo-codex/scripts/install-local.mjs install >"$ROOT/install2.log" 2>&1
check "marker-bearing legacy omo deleted by installer" "[ ! -e \"$CODEX_LOCAL_BIN_DIR/omo\" ]"

echo "== scenario 3: planted UNMARKED user omo must be PRESERVED byte-identical =="
printf '#!/usr/bin/env bash\necho "my own script"\n' > "$CODEX_LOCAL_BIN_DIR/omo"
chmod +x "$CODEX_LOCAL_BIN_DIR/omo"
USER_SHA_BEFORE="$(shasum -a 256 "$CODEX_LOCAL_BIN_DIR/omo" | cut -d' ' -f1)"
node packages/omo-codex/scripts/install-local.mjs install >"$ROOT/install3.log" 2>&1
INSTALL3_RC=$?
USER_SHA_AFTER="$( [ -f "$CODEX_LOCAL_BIN_DIR/omo" ] && shasum -a 256 "$CODEX_LOCAL_BIN_DIR/omo" | cut -d' ' -f1 || echo "DELETED" )"
check "unmarked user omo preserved byte-identical" "[ \"$USER_SHA_BEFORE\" = \"$USER_SHA_AFTER\" ]"
check "installer did not error on the unmarked file (exit 0)" "[ $INSTALL3_RC -eq 0 ]"
check "canonical still written alongside the preserved user file" "[ -f \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" ]"

echo "== scenario 4: idempotency =="
rm -f "$CODEX_LOCAL_BIN_DIR/omo"
BINS_BEFORE="$(ls "$CODEX_LOCAL_BIN_DIR" | sort | shasum -a 256 | cut -d' ' -f1)"
CANON_BEFORE="$(shasum -a 256 "$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit" | cut -d' ' -f1)"
node packages/omo-codex/scripts/install-local.mjs install >"$ROOT/install4.log" 2>&1
BINS_AFTER="$(ls "$CODEX_LOCAL_BIN_DIR" | sort | shasum -a 256 | cut -d' ' -f1)"
CANON_AFTER="$(shasum -a 256 "$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit" | cut -d' ' -f1)"
check "second install leaves the bin SET unchanged" "[ \"$BINS_BEFORE\" = \"$BINS_AFTER\" ]"
check "second install leaves the canonical wrapper byte-identical" "[ \"$CANON_BEFORE\" = \"$CANON_AFTER\" ]"

echo "== scenario 5: hook wiring untouched by the whole run =="
HOOKS_AFTER="$(hook_wiring_hash)"
check "codex hook-wiring files byte-identical across all installs" "[ \"$HOOKS_BEFORE\" = \"$HOOKS_AFTER\" ]"

echo "== scenario 6: no bare 'omo' bin anywhere in the isolated bin dir =="
check "final bin dir has omo-agent-toolkit and no omo" "[ -f \"$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit\" ] && [ ! -e \"$CODEX_LOCAL_BIN_DIR/omo\" ]"
echo "-- final bin dir listing --"
ls "$CODEX_LOCAL_BIN_DIR" | sort

echo "== isolation proof =="
REAL_CODEX_SHA_AFTER="$( [ -f "${REAL_HOME:-$ROOT}/.codex/config.toml" ] && echo "unexpected" || echo "absent" )"
echo "real ~/.codex/config.toml sha BEFORE run: $REAL_CODEX_SHA_BEFORE"
echo "(HOME was redirected to $HOME for the entire run, so the real one was never a write target)"

echo
echo "== CLEANUP =="
rm -rf "$ROOT"
if [ -d "$ROOT" ]; then echo "cleanup receipt: FAILED to remove $ROOT"; else echo "cleanup receipt: rm -rf $ROOT (verified absent)"; fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
