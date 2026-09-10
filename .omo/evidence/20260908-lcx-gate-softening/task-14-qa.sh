#!/usr/bin/env bash
# Evidence-only QA runner. Repository/product sources are never modified.
set -eEuo pipefail
trap 'printf "FAILED_COMMAND_LINE=%s EXIT=%s\n" "$LINENO" "$?" >&2' ERR
REPO_ROOT="$(git rev-parse --show-toplevel)"
export REPO_ROOT
EV="$REPO_ROOT/.omo/evidence/20260908-lcx-gate-softening"
REAL_CONFIG="$HOME/.codex/config.toml"
BEFORE="$(shasum "$REAL_CONFIG" | awk '{print $1}')"
ROOT="$(mktemp -d -t lcx-task14.XXXXXX)"
# The Node client's entrypoint guard compares URLs; use macOS's canonical path.
ROOT="$(cd "$ROOT" && pwd -P)"
cleanup() {
  local rc=$? after
  after="$(shasum "$REAL_CONFIG" | awk '{print $1}')"
  printf 'REAL_CODEX_SHA_BEFORE=%s\nREAL_CODEX_SHA_AFTER=%s\n' "$BEFORE" "$after"
  if [ "$BEFORE" != "$after" ]; then rc=1; fi
  rm -rf "$ROOT"
  if [ ! -e "$ROOT" ]; then printf 'REMOVAL_RECEIPT: %s REMOVED\n' "$ROOT"; else rc=1; fi
  printf 'QA_EXIT=%s\n' "$rc"
  exit "$rc"
}
trap cleanup EXIT
export CQA_PROTECTED_CONFIG_HOME="$HOME/.codex"
export HOME="$ROOT/home" TMPDIR="$ROOT/tmp"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache" XDG_STATE_HOME="$HOME/.local/state"
export OMO_CODING_AGENT_DIR="$HOME/.omo/agent"
export SENPI_CODING_AGENT_DIR="$OMO_CODING_AGENT_DIR" PI_CODING_AGENT_DIR="$OMO_CODING_AGENT_DIR"
export CODEX_BIN=/opt/homebrew/bin/codex
mkdir -p "$HOME" "$TMPDIR"
printf 'ISOLATED_HOME=%s\n' "$HOME"
"$CODEX_BIN" --version
cp -R "$REPO_ROOT/.agents/skills/codex-qa/scripts" "$ROOT/scripts"
# Only the disposable helper changes: isolate HOME while retaining the real
# config digest guard, and subscribe to mock readiness before starting it.
python3 - "$ROOT/scripts/lib/common.sh" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
# macOS mktemp -t uses the system temp root even with TMPDIR exported.
s = s.replace('mktemp -d -t cqa-home.XXXXXX', 'mktemp -d "$TMPDIR/cqa-home.XXXXXX"')
s = s.replace('cqa_real_codex_home() { printf \'%s\' "${HOME}/.codex"; }',
              'cqa_real_codex_home() { printf \'%s\' "$CQA_PROTECTED_CONFIG_HOME"; }')
start = s.index('cqa_start_mock() {')
end = s.index('\n# Install THIS repo', start)
s = s[:start] + '''cqa_start_mock() {
  local lib_dir fifo marker port extra
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fifo="$CQA_HOME_ROOT/mock-ready.fifo"
  mkfifo "$fifo" || return 1
  exec 9<> "$fifo"
  node "$lib_dir/mock-model.mjs" > "$fifo" 2> "$CQA_HOME_ROOT/mock.stderr" &
  CQA_MOCK_PID=$!; CQA_PIDS+=("$CQA_MOCK_PID")
  if ! read -r -t 10 marker port extra <&9; then
    exec 9>&-
    cqa_fail "mock readiness event did not arrive within 10 seconds"
    return 1
  fi
  exec 9>&-
  if [ "$marker" != "MOCK_LISTENING" ] || [ -z "$port" ] || [ -n "$extra" ]; then
    cqa_fail "invalid mock readiness event"
    return 1
  fi
  export MOCK_PORT="$port"
}
''' + s[end:]
p.write_text(s)
PY
for script in install-verify.sh app-server-drive.sh lib/app-server-client.mjs lib/mock-model.mjs; do
  cmp "$REPO_ROOT/.agents/skills/codex-qa/scripts/$script" "$ROOT/scripts/$script"
done
printf 'QA_DRIVER_AND_MOCK_BYTE_IDENTITY=PASS\n'
if diff -u "$REPO_ROOT/.agents/skills/codex-qa/scripts/lib/common.sh" "$ROOT/scripts/lib/common.sh" > "$EV/task-14-qa-harness.diff"; then
  printf 'FAIL: expected temporary readiness/isolation adaptation\n'; exit 1
else
  test "$?" -eq 1
fi
printf 'COMMAND: scripts/install-verify.sh --self-test\n'
bash "$ROOT/scripts/install-verify.sh" --self-test > "$EV/task-14-install-self-test.log" 2>&1
printf 'INSTALL_SELF_TEST_EXIT=0\n'
printf 'COMMAND: scripts/install-verify.sh --keep\n'
bash "$ROOT/scripts/install-verify.sh" --keep > "$EV/task-14-install.log" 2>&1
printf 'INSTALL_REAL_EXIT=0\n'
INSTALLED_HOME="$(awk '/^kept isolated home: / {sub(/^kept isolated home: /, ""); print}' "$EV/task-14-install.log")"
case "$INSTALLED_HOME" in "$ROOT"/tmp/*/codex) ;; *) printf 'FAIL: install escaped sandbox\n'; exit 1 ;; esac
manifests=("$INSTALLED_HOME"/plugins/cache/sisyphuslabs/omo/*/.codex-plugin/plugin.json)
test "${#manifests[@]}" -eq 1
manifest="${manifests[0]}"
count="$(jq '.hooks|length' "$manifest")"
cp "$manifest" "$EV/task-14-installed-manifest.json"
printf 'INSTALLED_CODEX_HOME=%s\nINSTALLED_MANIFEST=%s\nINSTALLED_HOOK_COUNT=%s\n' "$INSTALLED_HOME" "$manifest" "$count"
HOOK_COUNT_CONTRACT_EXIT=0
if ! test "$count" -eq 21; then
  printf 'FAIL: requested native installed cache count 21; observed %s\n' "$count"
  HOOK_COUNT_CONTRACT_EXIT=1
fi
snapshot="$INSTALLED_HOME/.tmp/marketplaces/sisyphuslabs/plugins/omo/.codex-plugin/plugin.json"
cp "$snapshot" "$EV/task-14-installed-marketplace-manifest.json"
printf 'INSTALLED_MARKETPLACE_MANIFEST=%s\nINSTALLED_MARKETPLACE_HOOK_COUNT=%s\n' "$snapshot" "$(jq '.hooks|length' "$snapshot")"
test "$(jq '.hooks|length' "$snapshot")" -eq 21
for landed in "$manifest" "$snapshot"; do
  jq -e '[.hooks[] | endswith("post-tool-use-recording-spawn-admission.json")] | any' "$landed"
  jq -e '[.hooks[] | endswith("subagent-stop-checking-ulw-execute-continuation.json")] | any | not' "$landed"
done
printf 'COMMAND: scripts/app-server-drive.sh --self-test\n'
bash "$ROOT/scripts/app-server-drive.sh" --self-test > "$EV/task-14-app-server-self-test.log" 2>&1
printf 'APP_SERVER_SELF_TEST_EXIT=0\n'
printf 'COMMAND: scripts/app-server-drive.sh --plugin --expect sessionStart,userPromptSubmit\n'
bash "$ROOT/scripts/app-server-drive.sh" --plugin --expect sessionStart,userPromptSubmit > "$EV/task-14-app-server.log" 2>&1
printf 'APP_SERVER_PLUGIN_EXIT=0\n'
python3 - "$EV" <<'PY'
from pathlib import Path
import json, sys
root = Path(sys.argv[1])
for stem in ['task-14-app-server-self-test', 'task-14-app-server']:
    text = (root / (stem + '.log')).read_text()
    value, _ = json.JSONDecoder().raw_decode(text[text.index('{'):])
    assert value['ok'] is True and value['turnStatus'] == 'completed', value
    assert not value['failedHooks'] and not value['missingHooks'], value
    if stem == 'task-14-app-server':
        hooks = value['hooks']
        for event in ['sessionStart', 'userPromptSubmit']:
            completed = [h for h in hooks if h['method'] == 'hook/completed'
                         and h['eventName'] == event and h['status'] == 'completed']
            assert completed, event
            for hook in completed:
                assert any(h['method'] == 'hook/started' and h['runId'] == hook['runId']
                           for h in hooks), hook
        print('HOOK_STARTED_COMPLETED_PAIRS=PASS')
    (root / (stem + '.json')).write_text(json.dumps(value, indent=2) + '\n')
PY
printf 'NO_LOCAL_BUN_TEST=1\nNO_AGENTIC_PROBES=1\n'
printf 'HOOK_COUNT_CONTRACT_EXIT=%s\n' "$HOOK_COUNT_CONTRACT_EXIT"
exit "$HOOK_COUNT_CONTRACT_EXIT"
