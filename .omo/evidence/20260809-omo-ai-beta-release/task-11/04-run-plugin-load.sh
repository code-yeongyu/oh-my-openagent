#!/bin/bash
set -euo pipefail
WT=/Volumes/mengmotaStorage/local-workspaces/omo/.local-ignore/worktrees/omo-ai-beta-release
E="$WT/.omo/evidence/20260809-omo-ai-beta-release/task-11"
PREFIX=$(cat "$E/.main-prefix")
LOG="$E/04-plugin-load-and-toolkit.txt"
exec > "$LOG" 2>&1
ROOT=$(mktemp -d -t omo-ai-task11-plugin.XXXXXX)
AGENT="$ROOT/agent"; HOME_QA="$ROOT/home"; XDG="$ROOT/xdg"; PROJECT="$ROOT/project"; SESSIONS="$ROOT/sessions"
mkdir -p "$AGENT" "$HOME_QA" "$XDG" "$PROJECT" "$SESSIONS"
printf '{\n  "defaultProjectTrust": "ask"\n}\n' > "$AGENT/settings.json"
cp "$AGENT/settings.json" "$ROOT/settings.before"
CAPTURE="$ROOT/http-requests.jsonl"
FIFO="$ROOT/ready.fifo"
mkfifo "$FIFO"
export OMO_TASK11_HTTP_CAPTURE="$CAPTURE"
node "$E/04-mock-http-server.mjs" > "$FIFO" 2> "$ROOT/server.stderr" &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" > "$E/.mock-server-pid"
IFS= read -r BASE_URL < "$FIFO"
rm -f "$FIFO"
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

echo '# Scenario 04 - REAL packaged plugin-load proof with HTTP mock provider and in-session toolkit tool result'
echo "root=$ROOT"
echo "prefix=$PREFIX"
echo "agent_dir=$AGENT"
echo "project=$PROJECT"
echo "session_dir=$SESSIONS"
echo "mock_server_pid=$SERVER_PID"
echo "mock_base_url=$BASE_URL"
echo 'settings_before:'; cat "$ROOT/settings.before"
echo '+ seed an isolated ulw-loop plan so status is a successful JSON command'
(cd "$PROJECT" && "$PREFIX/bin/omo" ulw-loop create-goals --session-id task11-isolated --brief 'Task 11 packaged runtime smoke' --json) > "$ROOT/seed.stdout" 2> "$ROOT/seed.stderr"
echo "seed_exit=$?"; cat "$ROOT/seed.stdout"; cat "$ROOT/seed.stderr"
echo '+ packaged omo -e mock-provider -p "ulw say hi"'
set +e
(cd "$PROJECT" && env HOME="$HOME_QA" XDG_CONFIG_HOME="$XDG" SENPI_CODING_AGENT_DIR="$AGENT" SENPI_CODING_AGENT_SESSION_DIR="$SESSIONS" OMO_SENPI_QA=1 OMO_TASK11_MOCK_BASE_URL="$BASE_URL" "$PREFIX/bin/omo" -e "$E/04-mock-http-provider.mjs" -p --mode json --provider omo-task11-http --model mock-1 --permission 'bash=allow' --approve --no-context-files 'ulw say hi') > "$ROOT/session.stdout" 2> "$ROOT/session.stderr"
SESSION_RC=$?
set -e
echo "session_exit=$SESSION_RC"
echo '--- session stdout ---'; cat "$ROOT/session.stdout"
echo '--- session stderr ---'; cat "$ROOT/session.stderr"
echo '--- mock HTTP request transcript ---'; cat "$CAPTURE"
[ "$SESSION_RC" -eq 0 ]
grep -q '<ultrawork-mode>' "$ROOT/session.stdout"; echo 'ultrawork_mode_in_session_transcript=PASS'
grep -q '<ultrawork-mode>' "$CAPTURE"; echo 'ultrawork_mode_on_mock_provider_wire=PASS'
grep -q 'command -v omo-agent-toolkit && omo-agent-toolkit ulw-loop status --session-id task11-isolated --json' "$CAPTURE"; echo 'provider_scripted_tool_call=PASS'
PACKAGED_RUNTIME="$(npm root -g --prefix "$PREFIX")/omo-ai/plugin/runtime/agent-toolkit/omo-agent-toolkit"
echo "expected_packaged_runtime=$PACKAGED_RUNTIME"
node - "$ROOT/session.stdout" "$PACKAGED_RUNTIME" <<'NODE'
const fs = require('node:fs')
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean)
const events = lines.flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
const event = events.find((item) => item?.type === 'tool_execution_end' && item?.toolName === 'bash')
if (!event || event.isError === true || event.result?.isError === true) throw new Error('successful bash tool_execution_end not found')
const text = (event.result?.content ?? []).map((part) => part?.text ?? '').join('')
if (!text.includes(process.argv[3])) throw new Error(`tool result missing packaged path ${process.argv[3]}`)
const firstBrace = text.indexOf('{')
const lastBrace = text.lastIndexOf('}')
if (firstBrace < 0 || lastBrace < firstBrace) throw new Error('tool result has no JSON payload')
const status = JSON.parse(text.slice(firstBrace, lastBrace + 1))
if (status?.ok !== true) throw new Error(`toolkit status was not ok: ${JSON.stringify(status)}`)
console.log('tool_execution_success=PASS')
console.log('tool_result_packaged_runtime_path=PASS')
console.log('tool_result_valid_status_json=PASS')
NODE
cmp -s "$ROOT/settings.before" "$AGENT/settings.json"; echo 'settings_byte_identical=PASS'
node -e 'const s=require(process.argv[1]); if (Object.hasOwn(s,"packages")) process.exit(1); console.log("settings_packages_absent=PASS")' "$AGENT/settings.json"
echo 'scenario_04=PASS'
echo '+ cleanup mock server'
kill "$SERVER_PID"
wait "$SERVER_PID"
if kill -0 "$SERVER_PID" 2>/dev/null; then echo 'mock_server_dead=FAIL'; exit 1; else echo 'mock_server_dead=PASS'; fi
echo "cleanup_receipt=kill $SERVER_PID; wait reaped; kill -0 failed"
cp "$ROOT/session.stdout" "$E/04-session.stdout.jsonl"
cp "$ROOT/session.stderr" "$E/04-session.stderr.txt"
cp "$CAPTURE" "$E/04-http-requests.jsonl"
cp "$ROOT/seed.stdout" "$E/04-seed-plan.stdout.json"
trap - EXIT
echo "+ rm -rf $ROOT"
rm -rf "$ROOT"
if [ -e "$ROOT" ]; then echo 'plugin_root_removed=FAIL'; exit 1; else echo 'plugin_root_removed=PASS'; fi
echo "cleanup_receipt=rm -rf $ROOT; path absent"
