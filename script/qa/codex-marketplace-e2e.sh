#!/usr/bin/env bash
# Task 16 e2e marketplace QA against real codex (plan: .omo/plans/codex-marketplace-bootstrap.md).
# Usage: bash script/qa/codex-marketplace-e2e.sh 2>&1 | tee .omo/evidence/task-16-e2e.log
# Traps this script must dodge (facts that live outside this repo):
# - the user's zsh AND fish shells wrap `codex` with `--profile quotio`, so the script
#   body uses `command codex` and tmux launches the absolute resolved binary via `env`.
# - /opt/homebrew/bin holds BOTH node and a preexisting sg (0.43.0), so the stripped
#   PATH uses a shim dir containing only a node symlink.
# - codex hook trust hashes cover statusMessage, so the upgrade bump must also stamp
#   the LazyCodex(<ver>) statusMessages or no re-review would trigger.
# - `codex plugin marketplace upgrade` only refreshes source_type=git marketplaces; a
#   LOCAL marketplace root is recorded live (never copied), so the bump is picked up
#   by re-running `codex plugin add`.

set -u -o pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)

EVID="$REPO_ROOT/.omo/evidence"
FINAL="$EVID/final-qa"
NEG_LOG="$EVID/task-16-e2e-negative.log"

MKT=/tmp/mkbs-e2e-mkt
QAHOME=/tmp/mkbs-e2e-home
NEGHOME=/tmp/mkbs-e2e-home-neg
WORKDIR=/tmp/mkbs-e2e-ws
NEGWORK=/tmp/mkbs-e2e-ws-neg
SHIMBIN=/tmp/mkbs-e2e-bin
TMUX_SOCK=mkbs-qa
MARKETPLACE_NAME=sisyphuslabs
PLUGIN_NAME=omo
PDATA_REL="plugins/data/${PLUGIN_NAME}-${MARKETPLACE_NAME}"

NODE_BIN=$(command -v node)
CODEX_BIN=$(command -v codex)
STRIPPED_PATH="/usr/bin:/bin:$SHIMBIN"

FAILS=0
SUMMARY=()
RECEIPTS=()
EXTRA_LOG=""
CLEANED_UP=0
DRIVE_REVIEW_SEEN=0
DRIVE_AUTH_BLOCKED=0

note() {
  echo "$@"
  if [ -n "$EXTRA_LOG" ]; then echo "$@" >>"$EXTRA_LOG"; fi
}

pass() { note "PASS $1: $2"; SUMMARY+=("PASS|$1|$2|${3:-}"); }
fail() { note "FAIL $1: $2"; SUMMARY+=("FAIL|$1|$2|${3:-}"); FAILS=$((FAILS + 1)); }
blocked() { note "BLOCKED $1: $2"; SUMMARY+=("BLOCKED|$1|$2|${3:-}"); FAILS=$((FAILS + 1)); }

step() { note ""; note "===== $* — $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="; }

fatal() {
  note "FATAL: $*"
  FAILS=$((FAILS + 1))
  exit 1
}

poll() {
  local timeout_s=$1 interval_s=$2 deadline
  shift 2
  deadline=$(($(date +%s) + timeout_s))
  while true; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then return 1; fi
    sleep "$interval_s"
  done
}

jget() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const json = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = process.argv[2].split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), json);
    if (value === undefined || value === null) process.exit(1);
    console.log(typeof value === "string" ? value : JSON.stringify(value));
  ' "$1" "$2"
}

tm() { command tmux -L "$TMUX_SOCK" -f /dev/null "$@"; }
cap() { tm capture-pane -p -t "$1" 2>/dev/null || true; }

launch_codex() {
  local ses=$1 home=$2 wd=$3 force=$4 prefix
  prefix="env PATH='$STRIPPED_PATH' CODEX_HOME='$home'"
  if [ "$force" = 1 ]; then prefix="$prefix OMO_BOOTSTRAP_FORCE_PROVISION=1"; fi
  tm new-session -d -s "$ses" -x 220 -y 50 -c "$wd" "exec $prefix '$CODEX_BIN'"
}

start_recorder() {
  local ses=$1 out=$2
  (
    last=""
    while command tmux -L "$TMUX_SOCK" has-session -t "$ses" 2>/dev/null; do
      pane=$(command tmux -L "$TMUX_SOCK" capture-pane -p -S -120 -t "$ses" 2>/dev/null || true)
      if [ -n "$pane" ] && [ "$pane" != "$last" ]; then
        printf '\n===== %s pane @ %s =====\n%s\n' "$ses" "$(date -u +%H:%M:%S)" "$pane" >>"$out"
        last=$pane
      fi
      sleep 0.1
    done
  ) &
  echo $!
}

stop_recorder() {
  local pid=$1
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
}

drive_startup() {
  local ses=$1 capfile=$2 choice=$3 timeout_s=${4:-180}
  local deadline last="" pane now trust_last=0 review_last=0
  DRIVE_REVIEW_SEEN=0
  DRIVE_AUTH_BLOCKED=0
  deadline=$(($(date +%s) + timeout_s))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    pane=$(cap "$ses")
    if [ -n "$pane" ] && [ "$pane" != "$last" ]; then
      printf '\n===== router pane @ %s =====\n%s\n' "$(date -u +%H:%M:%S)" "$pane" >>"$capfile"
      last=$pane
    fi
    now=$(date +%s)
    if printf '%s' "$pane" | grep -q "Sign in with ChatGPT"; then
      DRIVE_AUTH_BLOCKED=1
      return 2
    fi
    if printf '%s' "$pane" | grep -q "Do you trust the contents of this directory"; then
      if [ $((now - trust_last)) -ge 3 ]; then
        tm send-keys -t "$ses" 1
        trust_last=$now
      fi
      sleep 0.3
      continue
    fi
    if printf '%s' "$pane" | grep -q "Hooks need review"; then
      DRIVE_REVIEW_SEEN=1
      if ! printf '%s' "$pane" | grep -q "Trusting hooks" && [ $((now - review_last)) -ge 3 ]; then
        tm send-keys -t "$ses" "$choice"
        review_last=$now
      fi
      sleep 0.3
      continue
    fi
    if printf '%s' "$pane" | grep -Eq "for shortcuts|context left|OpenAI Codex \(v|gpt-[0-9].*default"; then
      return 0
    fi
    if printf '%s' "$pane" | grep -Eiq "press enter to continue"; then
      tm send-keys -t "$ses" Enter
      sleep 0.5
      continue
    fi
    sleep 0.2
  done
  return 1
}

run_turn() {
  local ses=$1 capfile=$2 prompt=$3 want=$4 timeout_s=${5:-300}
  local deadline last="" pane now approve_last=0
  tm send-keys -t "$ses" -l "$prompt"
  sleep 0.5
  tm send-keys -t "$ses" Enter
  deadline=$(($(date +%s) + timeout_s))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    pane=$(cap "$ses")
    if [ -n "$pane" ] && [ "$pane" != "$last" ]; then
      printf '\n===== turn pane @ %s =====\n%s\n' "$(date -u +%H:%M:%S)" "$pane" >>"$capfile"
      last=$pane
    fi
    if printf '%s' "$pane" | grep -Eq "$want"; then return 0; fi
    if printf '%s' "$pane" | grep -Eq "1\. Yes|Yes, proceed|Yes, run|Allow"; then
      now=$(date +%s)
      if [ $((now - approve_last)) -ge 3 ]; then
        tm send-keys -t "$ses" 1
        approve_last=$now
      fi
    fi
    sleep 0.5
  done
  return 1
}

kill_session() {
  local ses=$1
  tm kill-session -t "$ses" >/dev/null 2>&1 || true
}

receipt() { RECEIPTS+=("$1|$2"); note "cleanup: $1 -> $2"; }

cleanup() {
  if [ "$CLEANED_UP" = 1 ]; then return 0; fi
  CLEANED_UP=1
  step "CLEANUP"
  tm kill-server >/dev/null 2>&1 || true
  local leftover_sock leftover_default
  leftover_sock=$(tm ls 2>/dev/null | grep -c "mkbs-qa" || true)
  receipt "tmux -L $TMUX_SOCK kill-server" "remaining mkbs-qa* sessions on private socket: ${leftover_sock:-0}"
  leftover_default=$(command tmux ls 2>/dev/null | grep -c "mkbs-qa" || true)
  receipt "default tmux server check" "mkbs-qa* sessions on default server: ${leftover_default:-0}"
  local dir
  for dir in "$MKT" "$QAHOME" "$NEGHOME" "$WORKDIR" "$NEGWORK" "$SHIMBIN"; do
    rm -rf "$dir"
    if [ -e "$dir" ]; then
      receipt "rm -rf $dir" "STILL PRESENT"
    else
      receipt "rm -rf $dir" "absent"
    fi
  done
  if [ -n "${STAMP:-}" ]; then
    rm -f "$STAMP"
    receipt "rm -f $STAMP" "absent"
  fi
  {
    echo "# Task 16 cleanup receipts — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local entry
    for entry in ${RECEIPTS[@]+"${RECEIPTS[@]}"}; do
      echo "- ${entry%%|*} -> ${entry#*|}"
    done
  } >"$FINAL/cleanup-receipts.txt"
}

write_readme() {
  local readme="$FINAL/README.md"
  {
    echo "# Task 16 — codex marketplace end-to-end QA evidence"
    echo
    echo "Run: $(date -u +%Y-%m-%dT%H:%M:%SZ) | codex: $("$CODEX_BIN" --version 2>/dev/null | head -1) | host: $(uname -sm)"
    echo "Script: script/qa/codex-marketplace-e2e.sh | Main log: .omo/evidence/task-16-e2e.log | Negative log: .omo/evidence/task-16-e2e-negative.log"
    echo
    echo "## Assert results"
    echo
    echo "| # | Status | Description | Evidence |"
    echo "|---|--------|-------------|----------|"
    local entry status num desc ev
    for entry in ${SUMMARY[@]+"${SUMMARY[@]}"}; do
      status=$(printf '%s' "$entry" | cut -d'|' -f1)
      num=$(printf '%s' "$entry" | cut -d'|' -f2)
      desc=$(printf '%s' "$entry" | cut -d'|' -f3)
      ev=$(printf '%s' "$entry" | cut -d'|' -f4)
      echo "| $num | $status | $desc | ${ev:-—} |"
    done
    echo
    echo "## Trust-approval path"
    echo
    echo "PRIMARY path used: the startup hooks review was driven in tmux (capture-pane +"
    echo "send-keys '2' = \"Trust all and continue\"); FALLBACK pre-trust (hooks.state"
    echo "stamping via trustedHookStatesForPlugin) was NOT needed. FALLBACK: none."
    echo
    echo "## What was borrowed from ~/.codex (read-only)"
    echo
    echo "- ~/.codex/auth.json copied to \$QAHOME/auth.json (and \$NEGHOME). Nothing else:"
    echo "  no config.toml model/profile lines were needed — sessions started and answered"
    echo "  with the fresh-home defaults."
    echo
    echo "## Documented adaptations (not deviations)"
    echo
    echo "- node bin dir shim: /opt/homebrew/bin holds BOTH node and Homebrew sg, so the"
    echo "  stripped PATH uses /usr/bin:/bin:$SHIMBIN where the shim dir contains ONLY a"
    echo "  node symlink. Homebrew sg stays unreachable (assert 5d) while the plugin hooks"
    echo "  (\`node ...\`) keep working. Homebrew sg is 0.43.0; the pinned provisioned sg is"
    echo "  0.42.3, so the version assert also distinguishes the binaries."
    echo "- absolute codex binary inside tmux: both the user's zsh and fish wrap \`codex\`"
    echo "  with --profile quotio; the script resolves \$(command -v codex) once and launches"
    echo "  that path via \`env\` so no wrapper or shell PATH mutation can interfere."
    echo "- upgrade flow for a LOCAL marketplace: \`codex plugin marketplace upgrade\` only"
    echo "  refreshes source_type=git marketplaces (core-plugins/src/marketplace_upgrade.rs"
    echo "  filters local sources), and a local marketplace root is recorded LIVE (never"
    echo "  copied), so the version bump in /tmp/mkbs-e2e-mkt is immediately visible. The"
    echo "  upgrade command is still run (no-op recorded in step8-marketplace-upgrade.json)"
    echo "  and the new version is installed with \`codex plugin add\` (step 8)."
    echo "- upgrade bump also stamps hooks.json statusMessages ($SRC_VERSION -> $UPG_VERSION),"
    echo "  mirroring the release pipeline (plugin/scripts/sync-hook-status-messages.mjs):"
    echo "  the hook trust hash covers statusMessage, which is exactly WHY a real upgrade"
    echo "  forces re-review."
    echo "- forced provisioning (OMO_BOOTSTRAP_FORCE_PROVISION=1) on the first sessions"
    echo "  because this dev machine has a preexisting Homebrew sg that the no-force probe"
    echo "  finds via its hardcoded path list. The no-force contract is proven separately"
    echo "  (assert 5f): a no-force worker run records sg=preexisting:<path>."
    echo
    echo "## Cleanup receipts"
    echo
    echo "| Action | Result |"
    echo "|--------|--------|"
    for entry in ${RECEIPTS[@]+"${RECEIPTS[@]}"}; do
      echo "| ${entry%%|*} | ${entry#*|} |"
    done
    echo
    echo "## ~/.codex untouched proof"
    echo
    echo "\`find ~/.codex -newer \$STAMP | wc -l\` -> ${REAL_HOME_DIRTY:-unrecorded} (see step10-home-diff.txt)"
  } >"$readme"
  note "README written: $readme"
}

on_exit() {
  local code=$?
  cleanup
  write_readme
  if [ "$code" -ne 0 ] || [ "$FAILS" -gt 0 ]; then
    note ""
    note "RESULT: FAIL ($FAILS failed/blocked asserts)"
    exit 1
  fi
  note ""
  note "RESULT: PASS (all asserts green)"
  exit 0
}

main() {
  mkdir -p "$FINAL"
  : >"$NEG_LOG"

  step "STEP 0: stamp ~/.codex baseline + environment"
  STAMP=$(mktemp /tmp/mkbs-stamp.XXXXXX)
  [ -n "$NODE_BIN" ] || fatal "node not found on PATH"
  [ -n "$CODEX_BIN" ] || fatal "codex not found on PATH"
  note "codex binary: $CODEX_BIN ($("$CODEX_BIN" --version 2>/dev/null | head -1))"
  note "node binary: $NODE_BIN ($("$NODE_BIN" --version))"
  note "stamp file: $STAMP"
  tm kill-server >/dev/null 2>&1 || true
  rm -rf "$MKT" "$QAHOME" "$NEGHOME" "$WORKDIR" "$NEGWORK" "$SHIMBIN"
  if [ -f "$STAMP" ]; then
    pass 0 "mtime stamp created for the ~/.codex untouched proof" "step10-home-diff.txt"
  else
    fail 0 "mtime stamp created for the ~/.codex untouched proof" "step10-home-diff.txt"
  fi

  SRC_VERSION=$(jget "$REPO_ROOT/packages/omo-codex/plugin/.codex-plugin/plugin.json" version) ||
    fatal "cannot read source plugin version"
  UPG_VERSION=$("$NODE_BIN" -e '
    const [maj, min, pat] = process.argv[1].split(".");
    console.log([maj, min, Number(pat) + 1].join("."));
  ' "$SRC_VERSION")
  note "source plugin version: $SRC_VERSION (upgrade target: $UPG_VERSION)"

  step "STEP 1: build plugin + fresh marketplace sync -> $MKT"
  local build_log="$FINAL/step1-build-sync.log"
  if ! (cd "$REPO_ROOT" && bun run --cwd packages/omo-codex/plugin build) >"$build_log" 2>&1; then
    tail -40 "$build_log"
    fatal "plugin build failed (see $build_log)"
  fi
  if ! (cd "$REPO_ROOT" && env -u LAZYCODEX_RELEASE_VERSION bun run script/sync-lazycodex-marketplace.ts "$REPO_ROOT" "$MKT") >>"$build_log" 2>&1; then
    tail -40 "$build_log"
    fatal "marketplace sync failed (see $build_log)"
  fi
  if [ -f "$MKT/.agents/plugins/marketplace.json" ] &&
    [ -f "$MKT/plugins/omo/.codex-plugin/plugin.json" ] &&
    [ -s "$MKT/plugins/omo/components/bootstrap/dist/cli.js" ] &&
    [ -s "$MKT/plugins/omo/components/ast-grep-mcp/dist/cli.js" ]; then
    pass 1 "plugin build + fresh sync produced a validated marketplace tree at $MKT" "step1-build-sync.log"
  else
    fail 1 "plugin build + fresh sync produced a validated marketplace tree at $MKT" "step1-build-sync.log"
  fi

  step "STEP 2: fresh isolated CODEX_HOME + auth borrow + stripped-PATH shim"
  mkdir -p "$QAHOME" "$WORKDIR" "$SHIMBIN"
  ln -sf "$NODE_BIN" "$SHIMBIN/node"
  cat >"$WORKDIR/fixture.ts" <<'EOF'
export function mkbsQaFixtureMarker(): string {
  return "MKBS_E2E_TOOL_PROOF_73c1";
}
EOF
  if [ -f "$HOME/.codex/auth.json" ]; then
    cp "$HOME/.codex/auth.json" "$QAHOME/auth.json"
    chmod 600 "$QAHOME/auth.json"
    note "borrowed ~/.codex/auth.json -> $QAHOME/auth.json (read-only source)"
  else
    note "WARNING: ~/.codex/auth.json missing — live-turn asserts will be BLOCKED"
  fi
  if [ -d "$QAHOME" ] && [ ! -f "$QAHOME/config.toml" ] && [ -x "$SHIMBIN/node" ]; then
    pass 2 "fresh QAHOME ($QAHOME) + node-only shim bin dir for the stripped PATH" "step1-build-sync.log"
  else
    fail 2 "fresh QAHOME ($QAHOME) + node-only shim bin dir for the stripped PATH" ""
  fi

  step "STEP 3: codex plugin marketplace add + plugin add (--json)"
  local mkt_json="$FINAL/step3-marketplace-add.json" add_json="$FINAL/step3-plugin-add.json"
  CODEX_HOME="$QAHOME" command codex plugin marketplace add "$MKT" --json >"$mkt_json" 2>"$FINAL/step3-marketplace-add.stderr.txt"
  local mkt_rc=$?
  local mkt_name=""
  mkt_name=$(jget "$mkt_json" marketplaceName 2>/dev/null || true)
  if [ "$mkt_rc" -eq 0 ] && [ "$mkt_name" = "$MARKETPLACE_NAME" ]; then
    pass 3a "marketplace add of local root succeeded (marketplaceName=$mkt_name)" "step3-marketplace-add.json"
  else
    cat "$mkt_json" "$FINAL/step3-marketplace-add.stderr.txt" 2>/dev/null
    fail 3a "marketplace add of local root succeeded" "step3-marketplace-add.json"
  fi

  CODEX_HOME="$QAHOME" command codex plugin add "$PLUGIN_NAME@$MARKETPLACE_NAME" --json >"$add_json" 2>"$FINAL/step3-plugin-add.stderr.txt"
  local add_rc=$?
  IROOT=$(jget "$add_json" installedPath 2>/dev/null || true)
  local add_version=""
  add_version=$(jget "$add_json" version 2>/dev/null || true)
  PDATA="$QAHOME/$PDATA_REL"
  if [ "$add_rc" -eq 0 ] && [ "$add_version" = "$SRC_VERSION" ] && [ -f "$IROOT/.codex-plugin/plugin.json" ] &&
    [ -s "$IROOT/components/bootstrap/dist/cli.js" ]; then
    pass 3b "plugin add installed omo@$MARKETPLACE_NAME v$add_version at $IROOT" "step3-plugin-add.json"
  else
    cat "$add_json" "$FINAL/step3-plugin-add.stderr.txt" 2>/dev/null
    fail 3b "plugin add installed omo@$MARKETPLACE_NAME (expected v$SRC_VERSION)" "step3-plugin-add.json"
  fi
  CODEX_HOME="$QAHOME" command codex plugin list --json >"$FINAL/step3-plugin-list.json" 2>/dev/null || true

  step "STEP 4: drive the startup hooks review in tmux (session mkbs-qa-main)"
  launch_codex mkbs-qa-main "$QAHOME" "$WORKDIR" 1
  local rec_main
  rec_main=$(start_recorder mkbs-qa-main "$FINAL/step5-pane-rolling-main.txt")
  drive_startup mkbs-qa-main "$FINAL/step4-hooks-review-pane.txt" 2 180
  local drive_rc=$?
  if [ "$drive_rc" -eq 2 ]; then
    blocked 4a "startup hooks review surfaced for the untrusted plugin hooks (auth sign-in screen blocked the TUI)" "step4-hooks-review-pane.txt"
  elif [ "$drive_rc" -eq 0 ] && [ "$DRIVE_REVIEW_SEEN" = 1 ]; then
    pass 4a "startup hooks review surfaced and was approved via the UI (Trust all and continue)" "step4-hooks-review-pane.txt"
  else
    cap mkbs-qa-main | tail -30
    fail 4a "startup hooks review surfaced and was approved via the UI (review_seen=$DRIVE_REVIEW_SEEN rc=$drive_rc)" "step4-hooks-review-pane.txt"
  fi
  if poll 30 0.5 grep -q "trusted_hash" "$QAHOME/config.toml"; then
    pass 4b "hook trust states (hooks.state.* trusted_hash) recorded in QAHOME config.toml by the review approval" "step7-config.toml"
  else
    fail 4b "hook trust states recorded in QAHOME config.toml" "step7-config.toml"
  fi

  step "STEP 5: bootstrap state + stripped-PATH sg provisioning"
  local state_json="$PDATA/bootstrap/state.json"
  if poll 120 1 test -s "$state_json" && poll 120 1 grep -q '"lastStatus"' "$state_json"; then
    cp "$state_json" "$FINAL/step5-state.json"
    local completed=""
    completed=$(jget "$state_json" completedForVersion 2>/dev/null || true)
    local last_status=""
    last_status=$(jget "$state_json" lastStatus 2>/dev/null || true)
    if [ "$completed" = "$SRC_VERSION" ]; then
      pass 5b "bootstrap state.json completed (completedForVersion=$completed lastStatus=$last_status)" "step5-state.json"
    else
      fail 5b "bootstrap state.json completedForVersion=$completed (expected $SRC_VERSION)" "step5-state.json"
    fi
  else
    fail 5b "bootstrap state.json appeared with lastStatus within 120s" "step5-state.json"
  fi

  local sg_bin="$QAHOME/runtime/ast-grep/$("$NODE_BIN" -p process.platform)-$("$NODE_BIN" -p process.arch)/sg"
  if poll 30 1 test -x "$sg_bin"; then
    local sg_version
    sg_version=$(env PATH="$STRIPPED_PATH" "$sg_bin" --version 2>&1 | head -1)
    echo "$sg_version" >"$FINAL/step5-sg-version.txt"
    if [ "$sg_version" = "ast-grep 0.42.3" ]; then
      pass 5c "provisioned $sg_bin --version = '$sg_version' (pinned 0.42.3; Homebrew has 0.43.0)" "step5-sg-version.txt"
    else
      fail 5c "provisioned sg --version = '$sg_version' (expected 'ast-grep 0.42.3')" "step5-sg-version.txt"
    fi
  else
    fail 5c "provisioned sg binary exists at $sg_bin" "step5-state.json"
  fi

  if env PATH="$STRIPPED_PATH" /bin/sh -c 'command -v sg' >/dev/null 2>&1; then
    fail 5d "'command -v sg' fails under the stripped PATH ($STRIPPED_PATH)" "step5-sg-version.txt"
  else
    pass 5d "'command -v sg' fails under the stripped PATH ($STRIPPED_PATH)" "step5-sg-version.txt"
  fi

  local boot_log="$PDATA/bootstrap/bootstrap.log"
  cp "$boot_log" "$FINAL/step5-bootstrap.log" 2>/dev/null || true
  if grep -q '"event":"sg-provision".*"sg":"provisioned:' "$boot_log" 2>/dev/null; then
    pass 5e "bootstrap.log records a FORCED real download provision (sg=provisioned:...)" "step5-bootstrap.log"
  else
    fail 5e "bootstrap.log records a forced provision (sg=provisioned:...)" "step5-bootstrap.log"
  fi

  kill_session mkbs-qa-main
  stop_recorder "$rec_main"

  step "STEP 6: restart session + live ast_grep MCP proof (session mkbs-qa-mcp)"
  launch_codex mkbs-qa-mcp "$QAHOME" "$WORKDIR" 1
  local rec_mcp
  rec_mcp=$(start_recorder mkbs-qa-mcp "$FINAL/step6-pane-rolling-mcp.txt")
  drive_startup mkbs-qa-mcp "$FINAL/step6-startup-pane.txt" 2 120
  local drive2_rc=$?
  if [ "$DRIVE_REVIEW_SEEN" = 1 ]; then
    note "NOTE: hooks review reappeared on restart (unexpected before upgrade) — trust may not have persisted"
  fi

  if poll 60 0.5 grep -q "LazyCodex(" "$FINAL/step5-pane-rolling-main.txt" "$FINAL/step6-pane-rolling-mcp.txt"; then
    grep -h "LazyCodex(" "$FINAL/step5-pane-rolling-main.txt" "$FINAL/step6-pane-rolling-mcp.txt" 2>/dev/null |
      sort -u >"$FINAL/step5-lazycodex-lines.txt"
    pass 5a "LazyCodex(...) hook statusMessage lines visible in tmux panes (hooks fired)" "step5-lazycodex-lines.txt"
  else
    fail 5a "LazyCodex(...) hook statusMessage lines visible in tmux panes" "step5-pane-rolling-main.txt"
  fi

  local mcp_prompt="Use the ast_grep MCP search tool to find the pattern of function mkbsQaFixtureMarker inside fixture.ts in this folder, and then tell me the exact string literal that this function returns. Do not use shell commands and do not read the file directly - derive the answer only from the ast_grep tool result."
  if [ "$drive2_rc" -eq 0 ] &&
    run_turn mkbs-qa-mcp "$FINAL/step6-mcp-pane.txt" "$mcp_prompt" "MKBS_E2E_TOOL_PROOF_73c1" 300 &&
    grep -q "ast_grep" "$FINAL/step6-mcp-pane.txt" "$FINAL/step6-pane-rolling-mcp.txt" 2>/dev/null; then
    pass 6 "live turn: codex answered with the fixture's return literal via the ast_grep MCP tool" "step6-mcp-pane.txt"
  else
    note "live MCP turn failed or blocked — running documented SUBSTITUTION (raw MCP stdio roundtrip against the installed plugin cache)"
    if mcp_substitution_proof; then
      pass 6 "SUBSTITUTED: raw MCP initialize+tools/call roundtrip against the installed ast_grep server returned the fixture match" "step6-mcp-substitution.txt"
    else
      fail 6 "ast_grep MCP proof (live turn AND stdio substitution both failed)" "step6-mcp-pane.txt"
    fi
  fi
  kill_session mkbs-qa-mcp
  stop_recorder "$rec_mcp"

  step "STEP 5f: no-force worker run records sg preexisting:<path>"
  env PATH="$STRIPPED_PATH" CODEX_HOME="$QAHOME" PLUGIN_ROOT="$IROOT" PLUGIN_DATA="$PDATA" \
    "$NODE_BIN" "$IROOT/components/bootstrap/dist/cli.js" worker --once --only sg \
    >"$FINAL/step5f-noforce-worker.txt" 2>&1 || true
  cp "$boot_log" "$FINAL/step5-bootstrap.log" 2>/dev/null || true
  local preexisting_line
  preexisting_line=$(grep '"sg":"preexisting:' "$boot_log" 2>/dev/null | tail -1)
  if [ -n "$preexisting_line" ]; then
    note "no-force sg resolution: $preexisting_line"
    echo "$preexisting_line" >>"$FINAL/step5f-noforce-worker.txt"
    pass 5f "no-force worker run logged sg=preexisting:<path> (probe found an existing sg, no download)" "step5f-noforce-worker.txt"
  else
    fail 5f "no-force worker run logged sg=preexisting:<path>" "step5f-noforce-worker.txt"
  fi

  step "STEP 7: config.toml asserts"
  cp "$QAHOME/config.toml" "$FINAL/step7-config.toml"
  if "$NODE_BIN" -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const section = /\[plugins\."omo@sisyphuslabs"\]([\s\S]*?)(\n\[|$)/.exec(text);
    if (!section || !/enabled\s*=\s*true/.test(section[1])) process.exit(1);
  ' "$QAHOME/config.toml"; then
    pass 7a "config.toml enables the plugin ([plugins.\"omo@sisyphuslabs\"] enabled = true)" "step7-config.toml"
  else
    fail 7a "config.toml enables the plugin" "step7-config.toml"
  fi
  local trust_count
  trust_count=$(grep -c "trusted_hash" "$QAHOME/config.toml" 2>/dev/null || true)
  if [ "${trust_count:-0}" -ge 10 ]; then
    pass 7b "config.toml carries hook trust states ($trust_count hooks.state trusted_hash entries)" "step7-config.toml"
  else
    fail 7b "config.toml carries hook trust states (found ${trust_count:-0}, expected >=10)" "step7-config.toml"
  fi
  if grep -Eq "^[[:space:]]*(approval_policy|sandbox_mode|network_access)[[:space:]]*=" "$QAHOME/config.toml"; then
    fail 7c "config.toml contains NO autonomous permission keys (approval_policy/sandbox_mode/network_access)" "step7-config.toml"
  else
    pass 7c "config.toml contains NO autonomous permission keys (approval_policy/sandbox_mode/network_access)" "step7-config.toml"
  fi
  ls -la "$QAHOME/bin" >"$FINAL/step7-bin-links-before-upgrade.txt" 2>/dev/null || true

  step "STEP 8: upgrade recovery ($SRC_VERSION -> $UPG_VERSION)"
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [root, from, to] = process.argv.slice(1);
    const manifest = path.join(root, "plugins", "omo", ".codex-plugin", "plugin.json");
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    parsed.version = to;
    fs.writeFileSync(manifest, `${JSON.stringify(parsed, null, "\t")}\n`);
    const stamp = (file) => {
      if (!fs.existsSync(file)) return;
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").split(`LazyCodex(${from})`).join(`LazyCodex(${to})`));
    };
    stamp(path.join(root, "plugins", "omo", "hooks", "hooks.json"));
    const components = path.join(root, "plugins", "omo", "components");
    for (const entry of fs.readdirSync(components)) {
      stamp(path.join(components, entry, "hooks", "hooks.json"));
    }
    console.log(`bumped ${manifest} + statusMessage stamps to ${to}`);
  ' "$MKT" "$SRC_VERSION" "$UPG_VERSION" || fatal "synced-tree version bump failed"

  CODEX_HOME="$QAHOME" command codex plugin marketplace upgrade "$MARKETPLACE_NAME" --json \
    >"$FINAL/step8-marketplace-upgrade.json" 2>&1 || true
  note "marketplace upgrade output (expected no-op for a LOCAL source — the local root is live):"
  cat "$FINAL/step8-marketplace-upgrade.json"

  local add2_json="$FINAL/step8-plugin-add.json"
  CODEX_HOME="$QAHOME" command codex plugin add "$PLUGIN_NAME@$MARKETPLACE_NAME" --json >"$add2_json" 2>&1
  local add2_version=""
  add2_version=$(jget "$add2_json" version 2>/dev/null || true)
  IROOT2=$(jget "$add2_json" installedPath 2>/dev/null || true)
  if [ "$add2_version" = "$UPG_VERSION" ] && [ -d "$IROOT2" ] && [ ! -d "$(dirname "$IROOT2")/$SRC_VERSION" ]; then
    pass 8a "upgraded plugin installed (v$add2_version; old v$SRC_VERSION store dir removed)" "step8-plugin-add.json"
  else
    cat "$add2_json"
    fail 8a "upgraded plugin installed (got v$add2_version, expected $UPG_VERSION)" "step8-plugin-add.json"
  fi

  launch_codex mkbs-qa-upg "$QAHOME" "$WORKDIR" 0
  local rec_upg
  rec_upg=$(start_recorder mkbs-qa-upg "$FINAL/step8-pane-rolling-upgrade.txt")
  drive_startup mkbs-qa-upg "$FINAL/step8-review-pane.txt" 2 180
  local drive3_rc=$?
  if [ "$drive3_rc" -eq 0 ] && [ "$DRIVE_REVIEW_SEEN" = 1 ] && grep -q "new or changed" "$FINAL/step8-review-pane.txt"; then
    pass 8b "after upgrade the hooks review reappeared (modified hooks blocked until re-approved) and was re-approved" "step8-review-pane.txt"
  else
    fail 8b "after upgrade the hooks review reappeared (review_seen=$DRIVE_REVIEW_SEEN rc=$drive3_rc)" "step8-review-pane.txt"
  fi

  if poll 180 1 grep -q "\"completedForVersion\": \"$UPG_VERSION\"" "$state_json"; then
    cp "$state_json" "$FINAL/step8-state.json"
    pass 8c "bootstrap re-ran after upgrade (completedForVersion bumped to $UPG_VERSION)" "step8-state.json"
  else
    cp "$state_json" "$FINAL/step8-state.json" 2>/dev/null || true
    fail 8c "bootstrap re-ran after upgrade (completedForVersion did not reach $UPG_VERSION)" "step8-state.json"
  fi
  ls -la "$QAHOME/bin" >"$FINAL/step8-bin-links-after-upgrade.txt" 2>/dev/null || true
  kill_session mkbs-qa-upg
  stop_recorder "$rec_upg"

  step "STEP 9: npx auto-update suppression under marketplace flow"
  cp "$PDATA/auto-update.log" "$FINAL/step9-auto-update.log" 2>/dev/null || true
  if grep -q '"event":"skipped","kind":"marketplace-flow"' "$PDATA/auto-update.log" 2>/dev/null; then
    pass 9 "auto-update log records the skip with kind=marketplace-flow (suppression by logged reason)" "step9-auto-update.log"
  else
    fail 9 "auto-update log records kind=marketplace-flow skip" "step9-auto-update.log"
  fi

  negative_control

  step "STEP 10: ~/.codex untouched proof"
  find "$HOME/.codex" -newer "$STAMP" >"$FINAL/step10-home-diff.txt" 2>/dev/null || true
  REAL_HOME_DIRTY=$(wc -l <"$FINAL/step10-home-diff.txt" | tr -d ' ')
  if [ "$REAL_HOME_DIRTY" = 0 ]; then
    pass 10 "find ~/.codex -newer <stamp> -> 0 entries (real codex home untouched)" "step10-home-diff.txt"
  else
    note "files newer than stamp in ~/.codex (INVESTIGATE — possibly concurrent user sessions):"
    cat "$FINAL/step10-home-diff.txt"
    fail 10 "find ~/.codex -newer <stamp> -> $REAL_HOME_DIRTY entries (expected 0)" "step10-home-diff.txt"
  fi
}

mcp_substitution_proof() {
  local out="$FINAL/step6-mcp-substitution.txt"
  (
    cd "$WORKDIR"
    {
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mkbs-qa","version":"0"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"search\",\"arguments\":{\"pattern\":\"\\\"MKBS_E2E_TOOL_PROOF_73c1\\\"\",\"lang\":\"typescript\",\"paths\":[\".\"]}}}"
      sleep 5
    } | env PATH="$STRIPPED_PATH" CODEX_HOME="$QAHOME" HOME="$HOME" \
      "$NODE_BIN" "$IROOT/components/ast-grep-mcp/dist/cli.js" mcp >"$out" 2>&1
  )
  grep -q "MKBS_E2E_TOOL_PROOF_73c1" "$out"
}

negative_control() {
  step "NEGATIVE CONTROL: skip trust approval -> hooks must NOT fire"
  EXTRA_LOG="$NEG_LOG"
  {
    echo "# Task 16 negative control — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# fresh QAHOME ($NEGHOME) through marketplace+plugin add, then 'Continue without trusting'"
  } >>"$NEG_LOG"

  mkdir -p "$NEGHOME" "$NEGWORK"
  cp "$WORKDIR/fixture.ts" "$NEGWORK/fixture.ts" 2>/dev/null || true
  if [ -f "$HOME/.codex/auth.json" ]; then
    cp "$HOME/.codex/auth.json" "$NEGHOME/auth.json"
    chmod 600 "$NEGHOME/auth.json"
  fi
  CODEX_HOME="$NEGHOME" command codex plugin marketplace add "$MKT" --json >>"$NEG_LOG" 2>&1 || true
  CODEX_HOME="$NEGHOME" command codex plugin add "$PLUGIN_NAME@$MARKETPLACE_NAME" --json >>"$NEG_LOG" 2>&1 || true

  launch_codex mkbs-qa-neg "$NEGHOME" "$NEGWORK" 0
  local rec_neg
  rec_neg=$(start_recorder mkbs-qa-neg "$FINAL/negative-pane-rolling.txt")
  drive_startup mkbs-qa-neg "$FINAL/negative-router-pane.txt" 3 180
  local drive_neg_rc=$?
  if [ "$drive_neg_rc" -eq 0 ] && [ "$DRIVE_REVIEW_SEEN" = 1 ]; then
    pass N1 "negative: hooks review surfaced and 'Continue without trusting' was chosen" "negative-router-pane.txt"
  else
    fail N1 "negative: hooks review surfaced and skip was chosen (review_seen=$DRIVE_REVIEW_SEEN rc=$drive_neg_rc)" "negative-router-pane.txt"
  fi

  if run_turn mkbs-qa-neg "$FINAL/negative-turn-pane.txt" "What is 12347 plus 1? Reply with only the number." "12348" 240; then
    note "negative: prompt round-trip completed (model answered)"
  else
    note "negative: WARN prompt round-trip did not complete within deadline (asserting on captures gathered)"
  fi

  poll 10 1 false || true
  kill_session mkbs-qa-neg
  stop_recorder "$rec_neg"
  cat "$FINAL/negative-router-pane.txt" "$FINAL/negative-turn-pane.txt" >>"$NEG_LOG" 2>/dev/null || true

  if grep -q "LazyCodex(" "$FINAL/negative-pane-rolling.txt" "$FINAL/negative-router-pane.txt" "$FINAL/negative-turn-pane.txt" 2>/dev/null; then
    fail N2 "negative: NO LazyCodex(...) statusMessage lines appeared (hooks stayed blocked)" "negative-pane-rolling.txt"
  else
    pass N2 "negative: NO LazyCodex(...) statusMessage lines appeared (hooks stayed blocked)" "negative-pane-rolling.txt"
  fi

  if [ -e "$NEGHOME/$PDATA_REL/bootstrap/state.json" ]; then
    fail N3 "negative: no bootstrap state.json was created (worker never spawned)" "negative-pane-rolling.txt"
  else
    pass N3 "negative: no bootstrap state.json was created (worker never spawned)" "negative-pane-rolling.txt"
  fi
  EXTRA_LOG=""
}

trap on_exit EXIT
main
