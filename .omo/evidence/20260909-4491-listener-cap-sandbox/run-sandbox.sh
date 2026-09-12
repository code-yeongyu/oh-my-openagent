#!/usr/bin/env bash
# run-sandbox.sh - boot the real oh-my-openagent plugin in an isolated OpenCode
# sandbox next to listener-probe.mjs, exercise the session surface against a
# fake OpenAI-compatible LLM, and collect listener-cap evidence for PR #4491.
#
# Usage:
#   run-sandbox.sh --label before|after --tree <repo-tree> [--sessions N] [--runs N]
#
#   --tree      repository checkout whose packages/omo-opencode/src/index.ts is
#               loaded as the plugin under test (dev-ro for "before",
#               4491-pr for "after"). The tree is only READ.
#   --sessions  sessions to create/prompt/delete over HTTP (default 6)
#   --runs      `opencode run "hi" --format json` invocations (default 2)
#   --leak N    negative control: probe registers N no-op SIGHUP listeners at
#               server-init and removes them at dispose (default 0 = off)
#
# Output lands next to this script as *-<label>.* files. The XDG sandbox is a
# mktemp dir created by oqa_mk_isolated_xdg and removed by the EXIT trap.
# The real ~/.config/opencode and ~/.local/share/opencode are never touched;
# the real DB session count is recorded before/after as an isolation receipt.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
. "$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"

LABEL=""
TREE=""
SESSIONS=6
RUNS=2
LEAK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --tree) TREE="$2"; shift 2 ;;
    --sessions) SESSIONS="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --leak) LEAK="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[ -n "$LABEL" ] && [ -n "$TREE" ] || { printf 'need --label and --tree\n' >&2; exit 2; }
TREE="$(cd "$TREE" && pwd)"
PLUGIN_ENTRY="$TREE/packages/omo-opencode/src/index.ts"
PROBE_ENTRY="$SCRIPT_DIR/listener-probe.mjs"
[ -f "$PLUGIN_ENTRY" ] || { printf 'missing plugin entry %s\n' "$PLUGIN_ENTRY" >&2; exit 2; }

oqa_require opencode node curl jq sqlite3 || exit 2

REAL_HOME="$HOME"
OUT="$SCRIPT_DIR"
PROBE_OUT="$OUT/probe-$LABEL.jsonl"
FAKE_LOG="$OUT/fake-llm-$LABEL.log"
SERVE_OUT="$OUT/serve-$LABEL.stdout.txt"
SERVE_ERR="$OUT/serve-$LABEL.stderr.txt"
HARNESS="$OUT/harness-$LABEL.log"
RECEIPT="$OUT/receipt-$LABEL.txt"
rm -f "$PROBE_OUT" "$PROBE_OUT.phase" "$FAKE_LOG" "$SERVE_OUT" "$SERVE_ERR" "$HARNESS" "$RECEIPT" \
  "$OUT"/run-"$LABEL"-*.txt "$OUT/omo-log-$LABEL.txt"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$HARNESS" >&2; }
phase() { printf '%s' "$1" >"$PROBE_OUT.phase"; log "phase=$1"; }

FAKE_PID=""
stop_fake() {
  if [ -n "$FAKE_PID" ]; then
    kill "$FAKE_PID" 2>/dev/null || true
    sleep 0.5
    kill -0 "$FAKE_PID" 2>/dev/null && kill -9 "$FAKE_PID" 2>/dev/null || true
    FAKE_PID=""
  fi
}
cleanup_all() { stop_fake; oqa_cleanup; }
trap cleanup_all EXIT

# ---- versions + isolation receipt (before HOME is sandboxed) -----------------
{
  printf 'label=%s\n' "$LABEL"
  printf 'tree=%s\n' "$TREE"
  printf 'tree_head=%s\n' "$(git -C "$TREE" rev-parse HEAD)"
  printf 'tree_head_short=%s %s\n' "$(git -C "$TREE" rev-parse --short HEAD)" "$(git -C "$TREE" log -1 --format=%s)"
  printf 'plugin_entry=%s\n' "$PLUGIN_ENTRY"
  printf 'probe_entry=%s\n' "$PROBE_ENTRY"
  printf 'cap_constant_in_tree=%s\n' "$(rg -o 'PROCESS_LISTENERS_CAP_DEFAULT = [0-9]+' "$TREE/packages/omo-opencode/src/shared/raise-process-listeners-cap.ts" 2>/dev/null || echo 'absent (file not in tree)')"
  printf 'opencode_version=%s\n' "$(opencode --version 2>/dev/null)"
  printf 'opencode_bin=%s\n' "$(readlink -f "$(command -v opencode)")"
  printf 'bun_version=%s\n' "$(bun --version 2>/dev/null || echo n/a)"
  printf 'node_version=%s\n' "$(node --version)"
  printf 'uname=%s\n' "$(uname -srm)"
} >"$RECEIPT"
REAL_DB="$(opencode db path 2>/dev/null | head -1 || true)"
REAL_DB_BEFORE="n/a"
if [ -n "$REAL_DB" ] && [ -f "$REAL_DB" ]; then
  REAL_DB_BEFORE="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session' 2>/dev/null || echo n/a)"
fi
printf 'real_db_sessions_before=%s\n' "$REAL_DB_BEFORE" >>"$RECEIPT"

# ---- fake LLM ----------------------------------------------------------------
FAKE_STDOUT="$(mktemp -t lcap-fake.XXXXXX)"; OQA_TMPDIRS+=("$FAKE_STDOUT")
FAKE_LLM_LOG="$FAKE_LOG" FAKE_OPENAI_PORT=0 \
  node "$REPO_ROOT/.agents/skills/opencode-qa/scripts/lib/fake-openai-server.mjs" >"$FAKE_STDOUT" 2>&1 &
FAKE_PID=$!
FAKE_PORT=""
deadline=$(( $(date +%s) + 10 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  FAKE_PORT="$(grep '^fake-openai listening on ' "$FAKE_STDOUT" 2>/dev/null | head -1 | awk '{print $NF}')"
  [ -n "$FAKE_PORT" ] && break
  kill -0 "$FAKE_PID" 2>/dev/null || break
  sleep 0.2
done
[ -n "$FAKE_PORT" ] && curl -sf "http://127.0.0.1:$FAKE_PORT/health" >/dev/null \
  || { log "BLOCKED: fake LLM did not start"; cat "$FAKE_STDOUT" >&2; exit 1; }
log "fake LLM on 127.0.0.1:$FAKE_PORT"

# ---- isolated sandbox + config -----------------------------------------------
oqa_mk_isolated_xdg || exit 1
export TMPDIR="$OQA_XDG_ROOT/tmp"; mkdir -p "$TMPDIR"
printf 'sandbox_root=%s\n' "$OQA_XDG_ROOT" >>"$RECEIPT"
mkdir -p "$XDG_CONFIG_HOME/opencode"
sed -e "s#__PLUGIN_ENTRY__#$PLUGIN_ENTRY#" -e "s#__PROBE_ENTRY__#$PROBE_ENTRY#" -e "s#__FAKE_PORT__#$FAKE_PORT#" \
  "$SCRIPT_DIR/opencode.jsonc.template" >"$XDG_CONFIG_HOME/opencode/opencode.jsonc"
cat >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json" <<'JSON'
{
  "telemetry": false,
  "auto_update": false,
  "agents": {
    "explore": { "model": "openai/gpt-fake" },
    "librarian": { "model": "openai/gpt-fake" }
  }
}
JSON
export LISTENER_PROBE_OUT="$PROBE_OUT"
export LISTENER_PROBE_LEAK="$LEAK"
printf 'probe_leak_injection=%s\n' "$LEAK" >>"$RECEIPT"
phase startup

# ---- opencode serve ----------------------------------------------------------
PORT="$(oqa_free_port)"
PASS="lcap-${RANDOM}${RANDOM}"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 >"$SERVE_OUT" 2>"$SERVE_ERR" </dev/null &
OQA_SERVER_PID=$!

# Readiness: first wait for the "listening on <url>" line and take the URL from
# it, then poll /global/health with a bounded curl. A connection opened in the
# window between bind and handler wiring can hang forever, so every probe must
# carry --max-time (common.sh's oqa_wait_http does not, which stalled run 1).
URL=""
deadline=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  URL="$(sed -n 's/.*listening on \(http:\/\/[^ ]*\).*/\1/p' "$SERVE_OUT" | head -1)"
  [ -n "$URL" ] && break
  kill -0 "$OQA_SERVER_PID" 2>/dev/null || break
  sleep 0.2
done
[ -n "$URL" ] || { log "BLOCKED: opencode serve never printed its listening URL"; cat "$SERVE_ERR" >&2; exit 1; }
HEALTH=""
deadline=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  HEALTH="$(curl -s --max-time 3 -u "opencode:$PASS" "$URL/global/health" 2>/dev/null)"
  printf '%s' "$HEALTH" | grep -q '"healthy":true' && break
  HEALTH=""
  sleep 0.3
done
if [ -z "$HEALTH" ]; then
  log "BLOCKED: opencode serve at $URL never answered /global/health"; cat "$SERVE_ERR" >&2; exit 1
fi
log "serve healthy: $HEALTH"
printf 'serve_health=%s\n' "$HEALTH" >>"$RECEIPT"

enc_dir="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$OQA_PROJ")"
api() { curl -sS --max-time 60 -u "opencode:$PASS" "$@"; }

# Make the instance boot (plugins load per project instance). The first request
# transpiles and imports the whole omo source tree from a cold sandbox, which
# has taken >60s here, so the warm-up call gets a long timeout and retries.
t_boot=$(date +%s)
AGENT_COUNT=0
for attempt in 1 2 3; do
  curl -sS --max-time 240 -u "opencode:$PASS" "$URL/agent?directory=$enc_dir" >"$OQA_XDG_ROOT/agents.json" 2>/dev/null
  AGENT_COUNT="$(jq 'if type=="array" then length else 0 end' "$OQA_XDG_ROOT/agents.json" 2>/dev/null || echo 0)"
  [ "${AGENT_COUNT:-0}" -gt 0 ] && break
  log "instance warm-up attempt $attempt returned no agent list yet"
done
printf 'instance_bootstrap_seconds=%s\n' "$(( $(date +%s) - t_boot ))" >>"$RECEIPT"
OMO_AGENTS="$(jq -r '[.[].name] | map(select(. == "sisyphus" or . == "hephaestus" or . == "oracle" or . == "explore" or . == "librarian")) | join(",")' "$OQA_XDG_ROOT/agents.json" 2>/dev/null)"
log "agents registered: $AGENT_COUNT (omo agents seen: ${OMO_AGENTS:-none})"
printf 'agents_registered=%s\nomo_agents_seen=%s\n' "$AGENT_COUNT" "${OMO_AGENTS:-none}" >>"$RECEIPT"
sleep 3

# ---- sessions: create -> prompt -> wait -> delete ----------------------------
phase sessions-active
SES_IDS=()
for i in $(seq 1 "$SESSIONS"); do
  sid="$(api -X POST "$URL/session?directory=$enc_dir" -H 'content-type: application/json' \
    -d "{\"title\":\"listener cap probe $i\"}" | jq -r '.id // empty')"
  [ -n "$sid" ] || { log "BLOCKED: session create $i failed"; exit 1; }
  SES_IDS+=("$sid")
  api -X POST "$URL/session/$sid/prompt_async?directory=$enc_dir" -H 'content-type: application/json' \
    -d "{\"parts\":[{\"type\":\"text\",\"text\":\"listener cap probe $i: say hi\"}]}" >/dev/null
done
log "created+prompted ${#SES_IDS[@]} sessions"

# Completion = every session has an assistant message whose time.completed is
# set AND no session is listed busy. (/session/status alone is not enough: a
# freshly queued prompt is not yet busy, which let run 3 delete sessions early.)
completed_sessions() {
  local sid n done_count=0
  for sid in "${SES_IDS[@]}"; do
    n="$(api "$URL/session/$sid/message?directory=$enc_dir" 2>/dev/null \
      | jq '[.[] | select(.info.role=="assistant" and (.info.time.completed != null))] | length' 2>/dev/null || echo 0)"
    [ "${n:-0}" -ge 1 ] && done_count=$((done_count+1))
  done
  printf '%s' "$done_count"
}
deadline=$(( $(date +%s) + 180 ))
COMPLETED=0; busy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  COMPLETED="$(completed_sessions)"
  status="$(api "$URL/session/status?directory=$enc_dir" 2>/dev/null || echo '{}')"
  busy=0
  for sid in "${SES_IDS[@]}"; do printf '%s' "$status" | grep -q "$sid" && busy=$((busy+1)); done
  [ "$COMPLETED" -eq "${#SES_IDS[@]}" ] && [ "$busy" -eq 0 ] && break
  sleep 1
done
ASSISTANT_MSGS=0
for sid in "${SES_IDS[@]}"; do
  n="$(api "$URL/session/$sid/message?directory=$enc_dir" | jq '[.[] | select(.info.role=="assistant")] | length' 2>/dev/null || echo 0)"
  ASSISTANT_MSGS=$((ASSISTANT_MSGS + n))
done
LLM_CALLS_SERVE="$(grep -c 'branch=default' "$FAKE_LOG" 2>/dev/null || echo 0)"
log "sessions with a completed assistant reply: $COMPLETED/${#SES_IDS[@]}; assistant messages: $ASSISTANT_MSGS; fake LLM default-branch calls so far: $LLM_CALLS_SERVE; busy: $busy"
printf 'sessions=%s\nsessions_completed=%s\nassistant_messages=%s\nfake_llm_calls_during_sessions=%s\nsessions_busy_at_deadline=%s\n' \
  "${#SES_IDS[@]}" "$COMPLETED" "$ASSISTANT_MSGS" "$LLM_CALLS_SERVE" "$busy" >>"$RECEIPT"
sleep 3

phase sessions-deleted
DELETED=0
for sid in "${SES_IDS[@]}"; do
  api -X POST "$URL/session/$sid/abort?directory=$enc_dir" >/dev/null 2>&1 || true
  code="$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' -u "opencode:$PASS" -X DELETE "$URL/session/$sid?directory=$enc_dir")"
  [ "$code" = "200" ] && DELETED=$((DELETED+1))
done
REMAINING="$(api "$URL/session?directory=$enc_dir" | jq 'length' 2>/dev/null || echo '?')"
log "deleted $DELETED sessions; remaining in sandbox instance: $REMAINING"
printf 'sessions_deleted=%s\nsessions_remaining=%s\n' "$DELETED" "$REMAINING" >>"$RECEIPT"
sleep 4

# ---- opencode run (separate processes, same sandbox) ------------------------
phase cli-run
for i in $(seq 1 "$RUNS"); do
  # stdin must be /dev/null: `opencode run` reads a non-TTY stdin as extra prompt
  # input and waits for EOF, which under a harness pipe never comes.
  t_run=$(date +%s)
  ( cd "$OQA_PROJ" && timeout 120 opencode run "hi (listener cap probe run $i)" --format json \
      >"$OUT/run-$LABEL-$i.stdout.txt" 2>"$OUT/run-$LABEL-$i.stderr.txt" </dev/null )
  rc=$?
  printf 'run_%s_seconds=%s\n' "$i" "$(( $(date +%s) - t_run ))" >>"$RECEIPT"
  texts="$(jq -r 'select(.type=="text") | .part.text // .text // empty' "$OUT/run-$LABEL-$i.stdout.txt" 2>/dev/null | tr '\n' ' ' | cut -c1-80)"
  log "opencode run #$i exit=$rc text='${texts}'"
  printf 'run_%s_exit=%s\nrun_%s_text=%s\n' "$i" "$rc" "$i" "$texts" >>"$RECEIPT"
done

# ---- instance dispose (plugin dispose hook) then clean server stop ----------
phase disposed
DISPOSE_CODE="$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' -u "opencode:$PASS" -X POST "$URL/global/dispose")"
log "POST /global/dispose -> $DISPOSE_CODE"
printf 'global_dispose_http=%s\n' "$DISPOSE_CODE" >>"$RECEIPT"
sleep 4

phase shutdown
kill -TERM "$OQA_SERVER_PID" 2>/dev/null || true
for _ in $(seq 1 40); do kill -0 "$OQA_SERVER_PID" 2>/dev/null || break; sleep 0.25; done
if kill -0 "$OQA_SERVER_PID" 2>/dev/null; then
  log "serve did not exit on SIGTERM within 10s; SIGKILL"; kill -9 "$OQA_SERVER_PID" 2>/dev/null || true
  printf 'serve_exit=sigkill\n' >>"$RECEIPT"
else
  printf 'serve_exit=clean-on-sigterm\n' >>"$RECEIPT"
fi
OQA_SERVER_PID=""
stop_fake

# ---- collect -----------------------------------------------------------------
OMO_LOG="$TMPDIR/oh-my-opencode.log"
if [ -f "$OMO_LOG" ]; then
  grep -E "ENTRY - plugin loading|listener|MaxListeners" "$OMO_LOG" >"$OUT/omo-log-$LABEL.txt" 2>/dev/null || true
fi
WARN_SERVE="$(grep -c 'MaxListenersExceededWarning' "$SERVE_ERR" "$SERVE_OUT" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
WARN_RUN="$(cat "$OUT"/run-"$LABEL"-*.stderr.txt "$OUT"/run-"$LABEL"-*.stdout.txt 2>/dev/null | grep -c 'MaxListenersExceededWarning' || true)"
WARN_PROBE="$(grep -c '"isMaxListenersExceeded":true' "$PROBE_OUT" 2>/dev/null || true)"
LLM_CALLS="$(grep -c 'branch=' "$FAKE_LOG" 2>/dev/null || true)"
REAL_DB_AFTER="n/a"
if [ -n "$REAL_DB" ] && [ -f "$REAL_DB" ]; then
  REAL_DB_AFTER="$(sqlite3 "$REAL_DB" 'SELECT count(*) FROM session' 2>/dev/null || echo n/a)"
fi
{
  printf 'max_listeners_warning_serve_stdio=%s\n' "${WARN_SERVE:-0}"
  printf 'max_listeners_warning_run_stdio=%s\n' "${WARN_RUN:-0}"
  printf 'max_listeners_warning_probe=%s\n' "${WARN_PROBE:-0}"
  printf 'fake_llm_calls=%s\n' "${LLM_CALLS:-0}"
  printf 'real_db_sessions_after=%s\n' "$REAL_DB_AFTER"
  printf 'real_db_unchanged=%s\n' "$([ "$REAL_DB_AFTER" = "$REAL_DB_BEFORE" ] && echo yes || echo NO)"
} >>"$RECEIPT"
log "warnings: serve=$WARN_SERVE run=$WARN_RUN probe=$WARN_PROBE; fake LLM calls=$LLM_CALLS"

node "$SCRIPT_DIR/summarize.mjs" "$PROBE_OUT" "$OUT/summary-$LABEL.json" "$OUT/summary-$LABEL.md" \
  || log "summarize failed"

# ---- scrub -------------------------------------------------------------------
for f in "$OUT"/*-"$LABEL".* "$OUT"/*-"$LABEL"-*.txt "$OUT/omo-log-$LABEL.txt"; do
  [ -f "$f" ] || continue
  sed -i -e "s#$REAL_HOME#\$HOME#g" -e "s#$PASS#<redacted>#g" "$f"
done
rm -f "$PROBE_OUT.phase"
log "done ($LABEL)"
