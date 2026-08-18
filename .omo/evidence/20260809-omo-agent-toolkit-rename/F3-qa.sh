#!/bin/bash
set -u
set -o pipefail

WORKTREE="/Volumes/mengmotaStorage/local-workspaces/omo/.local-ignore/worktrees/omo-agent-toolkit-rename"
PASS_COUNT=0
FAIL_COUNT=0
ROOTS=()

say_cmd() { printf '\n$ %s\n' "$*"; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS: %s\n' "$*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL: %s\n' "$*"; }
assert_file() { if [ -f "$1" ]; then pass "$2"; else fail "$2 (missing: $1)"; fi; }
assert_absent() { if [ ! -e "$1" ] && [ ! -L "$1" ]; then pass "$2"; else fail "$2 (still present: $1)"; fi; }
assert_contains() { if grep -Fq "$2" "$1"; then pass "$3"; else fail "$3 (missing text: $2)"; fi; }
sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
new_root() {
  local label="$1"
  NEW_ROOT=$(mktemp -d "/tmp/omo-f3-${label}.XXXXXX") || exit 2
  ROOTS+=("$NEW_ROOT")
}
cleanup() {
  printf '\n## Cleanup receipts\n'
  local root
  for root in "${ROOTS[@]}"; do
    say_cmd "rm -rf $root"
    rm -rf "$root"
    if [ ! -e "$root" ]; then
      printf 'CLEANED: %s (absent after rm -rf)\n' "$root"
    else
      printf 'CLEANUP-FAIL: %s still exists\n' "$root"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  done
  printf '\nTOTAL PASS ASSERTIONS: %d\nTOTAL FAIL ASSERTIONS: %d\n' "$PASS_COUNT" "$FAIL_COUNT"
  if [ "$FAIL_COUNT" -eq 0 ]; then
    printf 'HARNESS RESULT: PASS\n'
  else
    printf 'HARNESS RESULT: FAIL\n'
  fi
}
trap cleanup EXIT

printf '# F3 independent QA raw transcript\n'
printf 'UTC start: '; date -u '+%Y-%m-%dT%H:%M:%SZ'
printf 'Worktree: %s\n' "$WORKTREE"
say_cmd 'uname -a'; uname -a
say_cmd 'node --version'; node --version
say_cmd 'npm --version'; npm --version
say_cmd 'git status --short --branch'; git -C "$WORKTREE" status --short --branch

printf '\n## Scenario 1: Codex edition main install/upgrade behavior\n'
new_root codex-main
ROOT="$NEW_ROOT"
HOME="$ROOT/home"
CODEX_HOME="$ROOT/codex-home"
CODEX_LOCAL_BIN_DIR="$ROOT/local-bin"
mkdir -p "$HOME" "$CODEX_HOME" "$CODEX_LOCAL_BIN_DIR"
printf 'ROOT=%s\nHOME=%s\nCODEX_HOME=%s\nCODEX_LOCAL_BIN_DIR=%s\n' "$ROOT" "$HOME" "$CODEX_HOME" "$CODEX_LOCAL_BIN_DIR"

run_codex_install() {
  local label="$1" log="$ROOT/${1}.log"
  say_cmd "HOME=$HOME CODEX_HOME=$CODEX_HOME CODEX_LOCAL_BIN_DIR=$CODEX_LOCAL_BIN_DIR node packages/omo-codex/scripts/install-local.mjs install"
  (cd "$WORKTREE" && HOME="$HOME" CODEX_HOME="$CODEX_HOME" CODEX_LOCAL_BIN_DIR="$CODEX_LOCAL_BIN_DIR" node packages/omo-codex/scripts/install-local.mjs install) 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  printf 'exit=%d (%s)\n' "$rc" "$label"
  return "$rc"
}

if run_codex_install install-1; then pass 'Codex first install exits 0'; else fail 'Codex first install exits nonzero'; fi
say_cmd "ls -la $CODEX_LOCAL_BIN_DIR"; ls -la "$CODEX_LOCAL_BIN_DIR"
WRAPPER="$CODEX_LOCAL_BIN_DIR/omo-agent-toolkit"
LEGACY="$CODEX_LOCAL_BIN_DIR/omo"
assert_file "$WRAPPER" 'omo-agent-toolkit wrapper exists'
assert_contains "$WRAPPER" 'OMO_GENERATED_RUNTIME_WRAPPER' 'wrapper carries runtime marker'
assert_contains "$WRAPPER" 'export OMO_INVOCATION_NAME=omo-agent-toolkit' 'wrapper exports OMO_INVOCATION_NAME=omo-agent-toolkit'
assert_contains "$WRAPPER" 'export OMO_EDITION=codex' 'wrapper exports OMO_EDITION=codex'
assert_absent "$LEGACY" 'legacy omo is absent after first install'
say_cmd "head -n 8 $WRAPPER"; head -n 8 "$WRAPPER"

say_cmd "plant marker-bearing legacy wrapper at $LEGACY"
printf '#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\necho legacy-managed\n' > "$LEGACY"
chmod 755 "$LEGACY"
sha256 "$LEGACY" | sed 's/^/marker-wrapper-sha256=/'
if run_codex_install install-2-marker-cleanup; then pass 'Codex marker-cleanup install exits 0'; else fail 'Codex marker-cleanup install exits nonzero'; fi
assert_absent "$LEGACY" 'marker-bearing legacy omo is deleted by subsequent install'

say_cmd "plant unmarked user-owned legacy file at $LEGACY"
printf '#!/bin/sh\nprintf "user-owned-omo:%s\\n" "$*"\n' > "$LEGACY"
chmod 755 "$LEGACY"
UNMARKED_BEFORE=$(sha256 "$LEGACY")
printf 'unmarked-before-sha256=%s\n' "$UNMARKED_BEFORE"
if run_codex_install install-3-unmarked-preservation; then pass 'Codex install with unmarked omo exits 0'; else fail 'Codex install with unmarked omo exits nonzero'; fi
UNMARKED_AFTER=$(sha256 "$LEGACY" 2>/dev/null || printf 'MISSING')
printf 'unmarked-after-sha256=%s\n' "$UNMARKED_AFTER"
if [ "$UNMARKED_BEFORE" = "$UNMARKED_AFTER" ]; then pass 'unmarked user-owned omo survives byte-identical'; else fail 'unmarked user-owned omo changed or disappeared'; fi

WRAPPER_BEFORE=$(sha256 "$WRAPPER")
BIN_LIST_BEFORE=$(find "$CODEX_LOCAL_BIN_DIR" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort | xargs -n1 basename | tr '\n' ',')
printf 'idempotence-before wrapper=%s bins=%s\n' "$WRAPPER_BEFORE" "$BIN_LIST_BEFORE"
if run_codex_install install-4-idempotence; then pass 'Codex second unchanged install exits 0'; else fail 'Codex second unchanged install exits nonzero'; fi
WRAPPER_AFTER=$(sha256 "$WRAPPER")
BIN_LIST_AFTER=$(find "$CODEX_LOCAL_BIN_DIR" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort | xargs -n1 basename | tr '\n' ',')
UNMARKED_FINAL=$(sha256 "$LEGACY" 2>/dev/null || printf 'MISSING')
printf 'idempotence-after wrapper=%s bins=%s unmarked=%s\n' "$WRAPPER_AFTER" "$BIN_LIST_AFTER" "$UNMARKED_FINAL"
if [ "$WRAPPER_BEFORE" = "$WRAPPER_AFTER" ] && [ "$BIN_LIST_BEFORE" = "$BIN_LIST_AFTER" ] && [ "$UNMARKED_BEFORE" = "$UNMARKED_FINAL" ]; then
  pass 'Codex repeated install is idempotent for wrapper bytes, bin entries, and user-owned omo bytes'
else
  fail 'Codex repeated install changed observable bin state'
fi

printf '\n## Scenario 2: npm fresh global install and published upgrade\n'
new_root npm
NPM_ROOT="$NEW_ROOT"
PACK_DIR="$NPM_ROOT/pack"
FRESH_PREFIX="$NPM_ROOT/fresh-prefix"
UPGRADE_PREFIX="$NPM_ROOT/upgrade-prefix"
NPM_CACHE="$NPM_ROOT/npm-cache"
mkdir -p "$PACK_DIR" "$FRESH_PREFIX" "$UPGRADE_PREFIX" "$NPM_CACHE"
printf 'NPM_ROOT=%s\nPACK_DIR=%s\nFRESH_PREFIX=%s\nUPGRADE_PREFIX=%s\nNPM_CACHE=%s\n' "$NPM_ROOT" "$PACK_DIR" "$FRESH_PREFIX" "$UPGRADE_PREFIX" "$NPM_CACHE"

say_cmd "npm pack --silent --pack-destination $PACK_DIR"
(cd "$WORKTREE" && npm_config_cache="$NPM_CACHE" npm pack --silent --pack-destination "$PACK_DIR") 2>&1 | tee "$NPM_ROOT/npm-pack.log"
PACK_RC=${PIPESTATUS[0]}
printf 'exit=%d (npm pack)\n' "$PACK_RC"
if [ "$PACK_RC" -eq 0 ]; then pass 'npm pack exits 0'; else fail 'npm pack exits nonzero'; fi
TARBALL=$(find "$PACK_DIR" -maxdepth 1 -type f -name '*.tgz' -print | head -n 1)
printf 'tarball=%s\n' "$TARBALL"
assert_file "$TARBALL" 'candidate tarball exists'

say_cmd "npm install -g --prefix $FRESH_PREFIX $TARBALL"
npm_config_cache="$NPM_CACHE" npm install -g --prefix "$FRESH_PREFIX" "$TARBALL" 2>&1 | tee "$NPM_ROOT/npm-fresh-install.log"
FRESH_RC=${PIPESTATUS[0]}
printf 'exit=%d (fresh candidate install)\n' "$FRESH_RC"
if [ "$FRESH_RC" -eq 0 ]; then pass 'fresh candidate global install exits 0'; else fail 'fresh candidate global install exits nonzero'; fi
say_cmd "find $FRESH_PREFIX/bin -mindepth 1 -maxdepth 1 -print -exec ls -ld {} \\;"
find "$FRESH_PREFIX/bin" -mindepth 1 -maxdepth 1 -print -exec ls -ld {} \; 2>&1
EXPECTED=$(printf '%s\n' lazycodex lazycodex-ai oh-my-openagent oh-my-opencode omo-agent-toolkit)
ACTUAL=$(find "$FRESH_PREFIX/bin" -mindepth 1 -maxdepth 1 -print | xargs -n1 basename | LC_ALL=C sort)
printf 'expected bins:\n%s\nactual bins:\n%s\n' "$EXPECTED" "$ACTUAL"
if [ "$ACTUAL" = "$EXPECTED" ]; then pass 'fresh npm linked bin set is exactly the required five names'; else fail 'fresh npm linked bin set differs from required five names'; fi
assert_absent "$FRESH_PREFIX/bin/omo" 'fresh npm install has no omo bin'

say_cmd "npm view oh-my-opencode@latest version bin --json"
npm_config_cache="$NPM_CACHE" npm view oh-my-opencode@latest version bin --json
say_cmd "npm install -g --prefix $UPGRADE_PREFIX oh-my-opencode@latest"
npm_config_cache="$NPM_CACHE" npm install -g --prefix "$UPGRADE_PREFIX" oh-my-opencode@latest 2>&1 | tee "$NPM_ROOT/npm-published-install.log"
PUB_RC=${PIPESTATUS[0]}
printf 'exit=%d (published latest install)\n' "$PUB_RC"
if [ "$PUB_RC" -eq 0 ]; then pass 'published latest global install exits 0'; else fail 'published latest global install exits nonzero'; fi
say_cmd "ls -la $UPGRADE_PREFIX/bin"; ls -la "$UPGRADE_PREFIX/bin"
assert_file "$UPGRADE_PREFIX/bin/omo" 'published latest links an omo bin before upgrade'

say_cmd "npm install -g --prefix $UPGRADE_PREFIX $TARBALL"
npm_config_cache="$NPM_CACHE" npm install -g --prefix "$UPGRADE_PREFIX" "$TARBALL" 2>&1 | tee "$NPM_ROOT/npm-upgrade.log"
UPGRADE_RC=${PIPESTATUS[0]}
printf 'exit=%d (candidate upgrade)\n' "$UPGRADE_RC"
if [ "$UPGRADE_RC" -eq 0 ]; then pass 'candidate upgrade over published latest exits 0'; else fail 'candidate upgrade over published latest exits nonzero'; fi
say_cmd "ls -la $UPGRADE_PREFIX/bin"; ls -la "$UPGRADE_PREFIX/bin"
assert_absent "$UPGRADE_PREFIX/bin/omo" 'candidate upgrade prunes the previously linked omo bin'
UPGRADE_ACTUAL=$(find "$UPGRADE_PREFIX/bin" -mindepth 1 -maxdepth 1 -print | xargs -n1 basename | LC_ALL=C sort)
printf 'upgrade actual bins:\n%s\n' "$UPGRADE_ACTUAL"
if [ "$UPGRADE_ACTUAL" = "$EXPECTED" ]; then pass 'upgraded npm linked bin set is exactly the required five names'; else fail 'upgraded npm linked bin set differs from required five names'; fi

printf '\n## Scenario 3: adversarial attempts\n'

printf '\n### Adversarial A: legacy omo is a symlink to a marker-bearing wrapper\n'
new_root adversarial-symlink
ADV_SYM="$NEW_ROOT"
mkdir -p "$ADV_SYM/home" "$ADV_SYM/codex-home" "$ADV_SYM/bin" "$ADV_SYM/user"
printf '#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\necho linked-managed\n' > "$ADV_SYM/user/marker-target"
chmod 755 "$ADV_SYM/user/marker-target"
ln -s "$ADV_SYM/user/marker-target" "$ADV_SYM/bin/omo"
say_cmd "ls -l $ADV_SYM/bin/omo; readlink $ADV_SYM/bin/omo; grep OMO_GENERATED_RUNTIME_WRAPPER $ADV_SYM/bin/omo"
ls -l "$ADV_SYM/bin/omo"; readlink "$ADV_SYM/bin/omo"; grep OMO_GENERATED_RUNTIME_WRAPPER "$ADV_SYM/bin/omo"
say_cmd "isolated Codex install with symlinked marker-bearing omo"
(cd "$WORKTREE" && HOME="$ADV_SYM/home" CODEX_HOME="$ADV_SYM/codex-home" CODEX_LOCAL_BIN_DIR="$ADV_SYM/bin" node packages/omo-codex/scripts/install-local.mjs install) 2>&1 | tee "$ADV_SYM/install.log"
SYM_RC=${PIPESTATUS[0]}
printf 'exit=%d symlink-present=%s target-present=%s\n' "$SYM_RC" "$(test -L "$ADV_SYM/bin/omo" && echo yes || echo no)" "$(test -f "$ADV_SYM/user/marker-target" && echo yes || echo no)"
if [ "$SYM_RC" -eq 0 ]; then pass 'installer remains operational with symlinked legacy omo'; else fail 'installer fails with symlinked legacy omo'; fi
if [ -L "$ADV_SYM/bin/omo" ]; then
  fail 'adversarial symlink leaves an invokable marker-bearing legacy omo path present'
else
  pass 'adversarial symlinked marker-bearing legacy omo path is removed'
fi

printf '\n### Adversarial B: pre-existing directory named omo\n'
new_root adversarial-directory
ADV_DIR="$NEW_ROOT"
mkdir -p "$ADV_DIR/home" "$ADV_DIR/codex-home" "$ADV_DIR/bin/omo"
printf 'user directory sentinel\n' > "$ADV_DIR/bin/omo/sentinel"
say_cmd "isolated Codex install with directory at bin/omo"
(cd "$WORKTREE" && HOME="$ADV_DIR/home" CODEX_HOME="$ADV_DIR/codex-home" CODEX_LOCAL_BIN_DIR="$ADV_DIR/bin" node packages/omo-codex/scripts/install-local.mjs install) 2>&1 | tee "$ADV_DIR/install.log"
DIR_RC=${PIPESTATUS[0]}
printf 'exit=%d directory-present=%s sentinel=' "$DIR_RC" "$(test -d "$ADV_DIR/bin/omo" && echo yes || echo no)"; cat "$ADV_DIR/bin/omo/sentinel" 2>/dev/null || true
if [ "$DIR_RC" -eq 0 ] && [ -d "$ADV_DIR/bin/omo" ] && grep -Fq 'user directory sentinel' "$ADV_DIR/bin/omo/sentinel"; then
  pass 'installer preserves a user-owned directory named omo and still exits 0'
else
  fail 'installer mishandles a pre-existing directory named omo'
fi
assert_file "$ADV_DIR/bin/omo-agent-toolkit" 'new wrapper is still installed beside directory named omo'

printf '\n### Adversarial C: two installs started concurrently in the same isolated root\n'
new_root adversarial-concurrent
ADV_CON="$NEW_ROOT"
mkdir -p "$ADV_CON/home" "$ADV_CON/codex-home" "$ADV_CON/bin"
say_cmd "start two identical install-local.mjs install processes in background"
(cd "$WORKTREE" && HOME="$ADV_CON/home" CODEX_HOME="$ADV_CON/codex-home" CODEX_LOCAL_BIN_DIR="$ADV_CON/bin" node packages/omo-codex/scripts/install-local.mjs install >"$ADV_CON/install-a.log" 2>&1) & PID_A=$!
(cd "$WORKTREE" && HOME="$ADV_CON/home" CODEX_HOME="$ADV_CON/codex-home" CODEX_LOCAL_BIN_DIR="$ADV_CON/bin" node packages/omo-codex/scripts/install-local.mjs install >"$ADV_CON/install-b.log" 2>&1) & PID_B=$!
wait "$PID_A"; RC_A=$?
wait "$PID_B"; RC_B=$?
printf '%s\n' '--- install A output ---'; cat "$ADV_CON/install-a.log"
printf '%s\n' '--- install B output ---'; cat "$ADV_CON/install-b.log"
printf 'concurrent exits: A=%d B=%d\n' "$RC_A" "$RC_B"
say_cmd "ls -la $ADV_CON/bin"; ls -la "$ADV_CON/bin"
if [ "$RC_A" -eq 0 ] && [ "$RC_B" -eq 0 ]; then pass 'both concurrent installs exit 0'; else fail 'at least one concurrent install exits nonzero'; fi
assert_file "$ADV_CON/bin/omo-agent-toolkit" 'concurrent install leaves new runtime wrapper present'
assert_absent "$ADV_CON/bin/omo" 'concurrent install leaves legacy omo absent'
if grep -Fq 'OMO_GENERATED_RUNTIME_WRAPPER' "$ADV_CON/bin/omo-agent-toolkit" && grep -Fq 'export OMO_INVOCATION_NAME=omo-agent-toolkit' "$ADV_CON/bin/omo-agent-toolkit"; then
  pass 'concurrent install leaves a complete, correctly named wrapper'
else
  fail 'concurrent install leaves an incomplete or incorrect wrapper'
fi

printf '\n## Post-run source status\n'
say_cmd 'git status --short --branch'
git -C "$WORKTREE" status --short --branch
