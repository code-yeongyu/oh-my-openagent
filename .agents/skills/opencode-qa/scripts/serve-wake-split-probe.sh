#!/usr/bin/env bash
# serve-wake-split-probe.sh
# Serve-topology wake runner-split QA harness.
#
# Proves whether omo's plugin-origin promptAsync (parent-wake bg notifications)
# forks a second concurrent LLM runner in opencode serve topology (REPRODUCED)
# or routes correctly through the live listener (FIXED).
#
# Two assertion modes:
#   --expect reproduced   exit 0 if stops>1 OR children>1 OR mechanism arm true
#   --expect fixed        exit 0 if children==1 AND stops==1
#
# Usage:
#   serve-wake-split-probe.sh [--expect reproduced|fixed] [--evidence-dir DIR]
#                             [--self-test] [--help]
#
# Env:
#   OMO_SANDBOX_OMO_CONFIG   JSON string; when set, deep-merged over the base
#                            agent overrides (env keys win) and written to
#                            $XDG_CONFIG_HOME/opencode/oh-my-openagent.json
#                            before the server starts (flag-disabled control).
#   FAKE_OPENAI_PORT         Force the fake-LLM to bind a specific port
#                            (default: random). Port 1 triggers a startup
#                            failure test used by the self-test failure path.
#
# Exit codes:
#   0   expectation met (or --self-test OK)
#   1   expectation NOT met, or internal harness error
#   2   usage / bad arguments

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"

# ---- defaults ----------------------------------------------------------------
EXPECT_MODE=""      # reproduced | fixed
EVIDENCE_DIR=""
SELF_TEST=0
FAKE_SERVER_PID=""
FAKE_SERVER_PORT=""
FAKE_LLM_LOG=""     # set after evidence dir is known

# ---- argument parsing --------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --expect)
      EXPECT_MODE="$2"
      shift 2
      ;;
    --evidence-dir)
      EVIDENCE_DIR="$2"
      shift 2
      ;;
    --self-test)
      SELF_TEST=1
      shift
      ;;
    -h|--help)
      sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [ "$SELF_TEST" -eq 0 ] && [ -z "$EXPECT_MODE" ]; then
  EXPECT_MODE="reproduced"
fi

if [ -n "$EXPECT_MODE" ] && [ "$EXPECT_MODE" != "reproduced" ] && [ "$EXPECT_MODE" != "fixed" ]; then
  printf 'error: --expect must be reproduced or fixed\n' >&2
  exit 2
fi

# ---- helpers -----------------------------------------------------------------

swsp_log()  { printf '%s\n' "$*" >&2; }
swsp_info() { printf '[swsp] %s\n' "$*" >&2; }

# Start the fake-LLM server; sets FAKE_SERVER_PID + FAKE_SERVER_PORT.
swsp_start_fake_llm() {
  local log_file="$1"
  local port_file
  port_file="$(mktemp -t swsp-port.XXXXXX)"
  OQA_TMPDIRS+=("$port_file")

  FAKE_LLM_LOG="$log_file" FAKE_OPENAI_PORT="${FAKE_OPENAI_PORT:-0}" \
    bun run --bun "$SCRIPT_DIR/lib/fake-openai-server.mjs" >"$port_file.stdout" 2>&1 &
  FAKE_SERVER_PID=$!
  disown "$FAKE_SERVER_PID" 2>/dev/null || true

  # Poll for the port line (fake-openai listening on <port>)
  local deadline
  deadline=$(( $(date +%s) + 10 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if grep -q "^fake-openai listening on " "$port_file.stdout" 2>/dev/null; then
      FAKE_SERVER_PORT="$(grep "^fake-openai listening on " "$port_file.stdout" | head -1 | awk '{print $NF}')"
      break
    fi
    if ! kill -0 "$FAKE_SERVER_PID" 2>/dev/null; then
      swsp_log "FAIL: fake-openai server process died immediately"
      cat "$port_file.stdout" >&2 2>/dev/null || true
      return 1
    fi
    sleep 0.3
  done
  OQA_TMPDIRS+=("$port_file.stdout")

  if [ -z "$FAKE_SERVER_PORT" ]; then
    swsp_log "FAIL: fake-openai server did not report port within 10s"
    cat "$port_file.stdout" >&2 2>/dev/null || true
    kill "$FAKE_SERVER_PID" 2>/dev/null || true
    return 1
  fi

  # Verify it's up
  local hdeadline=0
  hdeadline=$(( $(date +%s) + 5 ))
  while [ "$(date +%s)" -lt "$hdeadline" ]; do
    if curl -sf "http://127.0.0.1:${FAKE_SERVER_PORT}/health" >/dev/null 2>&1; then
      swsp_info "fake-openai listening on port $FAKE_SERVER_PORT"
      return 0
    fi
    sleep 0.2
  done
  swsp_log "FAIL: fake-openai /health did not respond within 5s on port $FAKE_SERVER_PORT"
  kill "$FAKE_SERVER_PID" 2>/dev/null || true
  return 1
}

swsp_stop_fake_llm() {
  if [ -n "$FAKE_SERVER_PID" ]; then
    kill "$FAKE_SERVER_PID" 2>/dev/null || true
    sleep 0.3
    kill -0 "$FAKE_SERVER_PID" 2>/dev/null && kill -9 "$FAKE_SERVER_PID" 2>/dev/null || true
    FAKE_SERVER_PID=""
  fi
}

# Write the sandbox omo config: base agent overrides (explore/librarian -> the
# fake provider, required for child model resolution) deep-merged with
# OMO_SANDBOX_OMO_CONFIG when set (jq '.[0] * .[1]'; env keys win).
# Args: sandbox_config_dir
swsp_write_omo_config() {
  local cfg_dir="$1"
  local omo_cfg="$cfg_dir/opencode/oh-my-openagent.json"
  local base='{"agents":{"explore":{"model":"openai/gpt-fake"},"librarian":{"model":"openai/gpt-fake"}}}'

  mkdir -p "$cfg_dir/opencode"
  if [ -n "${OMO_SANDBOX_OMO_CONFIG:-}" ]; then
    if ! printf '%s\n%s\n' "$base" "$OMO_SANDBOX_OMO_CONFIG" | jq -s '.[0] * .[1]' >"$omo_cfg" 2>/dev/null; then
      swsp_log "FAIL: OMO_SANDBOX_OMO_CONFIG is not valid JSON"
      return 1
    fi
    swsp_info "wrote merged OMO_SANDBOX_OMO_CONFIG to $omo_cfg"
  else
    printf '%s\n' "$base" >"$omo_cfg"
    swsp_info "wrote agent overrides to $omo_cfg"
  fi
}

# Write the sandbox opencode.jsonc with the fake provider + local plugin.
# Args: sandbox_config_dir fake_port
swsp_write_opencode_config() {
  local cfg_dir="$1"
  local fake_port="$2"
  local repo_root
  repo_root="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

  mkdir -p "$cfg_dir/opencode"
  cat >"$cfg_dir/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${repo_root}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "fake-key",
        "baseURL": "http://127.0.0.1:${fake_port}/v1",
        "timeout": 30000
      },
      "models": {
        "gpt-fake": {
          "tool_call": true,
          "limit": {
            "context": 200000,
            "output": 8192
          }
        }
      }
    }
  },
  "permission": {
    "bash": "allow",
    "call_omo_agent": "allow"
  }
}
JSONC
  swsp_info "opencode.jsonc written to $cfg_dir/opencode/opencode.jsonc"
}

# Poll the sandbox DB for children/stops on a message matching a LIKE pattern.
# Args: db_path like_pattern timeout_s
# Outputs: "<children> <stops>" on stdout
swsp_poll_db_metrics() {
  local db="$1"
  local like_pat="$2"
  local timeout_s="${3:-90}"
  local deadline
  local metrics_query="
      WITH target AS (
        SELECT m.id AS user_id, m.session_id
        FROM message m
        JOIN part p ON p.message_id = m.id
        WHERE json_extract(m.data, '\$.role') = 'user'
          AND json_extract(p.data, '\$.type') = 'text'
          AND json_extract(p.data, '\$.text') LIKE '${like_pat}'
      ),
      counts AS (
        SELECT
          count(a.id) AS children,
          sum(CASE WHEN json_extract(a.data, '\$.finish') = 'stop' THEN 1 ELSE 0 END) AS stops
        FROM target t
        LEFT JOIN message a
          ON a.session_id = t.session_id
          AND json_extract(a.data, '\$.parentID') = t.user_id
        GROUP BY t.user_id
      )
      SELECT printf('%d %d',
        coalesce((SELECT max(children) FROM counts), 0),
        coalesce((SELECT max(stops) FROM counts), 0)
      );
  "

  deadline=$(( $(date +%s) + timeout_s ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ ! -f "$db" ]; then
      sleep 0.5
      continue
    fi
    local result
    result="$(sqlite3 "$db" "$metrics_query" 2>/dev/null)" || true

    local children stops
    children="$(printf '%s' "$result" | awk '{print $1}')"
    stops="$(printf '%s' "$result" | awk '{print $2}')"

    # Return once we have at least 1 stop (parent session finished)
    if [ -n "$stops" ] && [ "${stops:-0}" -ge 1 ] 2>/dev/null; then
      printf '%s %s' "$children" "$stops"
      return 0
    fi
    sleep 0.5
  done

  # Return whatever we have on timeout
  local result
  result="$(sqlite3 "$db" "$metrics_query" 2>/dev/null)" || true
  printf '%s' "${result:-0 0}"
}

# Wait until a session is no longer in the server's active status map.
# Args: server_url pass session_id timeout_s
swsp_wait_session_idle() {
  local url="$1" pass="$2" ses_id="$3" timeout_s="${4:-120}"
  local deadline
  deadline=$(( $(date +%s) + timeout_s ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local status_json
    status_json="$(curl -sf -u "opencode:${pass}" "${url}/session/status" 2>/dev/null)" || true
    if [ -z "$status_json" ] || ! printf '%s' "$status_json" | grep -q "$ses_id" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  swsp_log "WARNING: session $ses_id did not go idle within ${timeout_s}s; proceeding with current DB state"
  return 0
}

# Count plugin_inits from the omo log since a byte offset, filtered to sandbox dir.
# Args: log_offset sandbox_dir
swsp_count_plugin_inits() {
  local offset="$1"
  local sandbox_dir="$2"
  local log_path="${TMPDIR:-/tmp}/oh-my-opencode.log"
  if [ ! -f "$log_path" ]; then
    printf '0'
    return 0
  fi
  # tail from byte offset
  tail -c "+$((offset + 1))" "$log_path" 2>/dev/null \
    | grep "ENTRY - plugin loading" \
    | grep -c "$sandbox_dir" 2>/dev/null \
    || printf '0'
}

# Detect WAKE_DISPATCHED_DURING_PARENT_TURN:
# true iff the omo log (since offset) contains a [prompt-async-gate] promptAsync dispatching
# line with source containing "parent-wake", AND that line's timestamp is within the
# parent-hold window (between branch=parent-hold line and next non-wake completion).
# Args: log_offset fake_llm_log sandbox_dir
swsp_detect_wake_during_parent() {
  local offset="$1"
  local fake_log="$2"
  local sandbox_dir="$3"
  local omo_log="${TMPDIR:-/tmp}/oh-my-opencode.log"

  # Find parent-hold timestamp from fake-llm.log
  local hold_ts
  hold_ts="$(grep "branch=parent-hold" "$fake_log" 2>/dev/null | head -1 | grep -o '\[.*\]' | tr -d '[]')" || true

  if [ -z "$hold_ts" ]; then
    # parent-hold never fired — cannot determine
    printf 'false'
    return 0
  fi

  # Check for gate dispatch log line with parent-wake source since offset
  local dispatch_line
  dispatch_line="$(tail -c "+$((offset + 1))" "$omo_log" 2>/dev/null \
    | grep "promptAsync dispatching" \
    | grep -i "parent-wake\|background-agent-parent-wake" \
    | head -1)" || true

  if [ -z "$dispatch_line" ]; then
    printf 'false'
    return 0
  fi

  # Extract timestamp from dispatch line (ISO 8601 in brackets or as prefix)
  local dispatch_ts
  dispatch_ts="$(printf '%s' "$dispatch_line" | grep -o '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' | head -1)" || true

  if [ -z "$dispatch_ts" ]; then
    # Can't compare timestamps — fall back to presence check
    printf 'true'
    return 0
  fi

  # Simple lexicographic timestamp compare (ISO 8601 sorts correctly)
  # The hold_ts is the start of the hold window; if dispatch happened after it, signal is true
  if [ "$dispatch_ts" \> "$hold_ts" ] || [ "$dispatch_ts" = "$hold_ts" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

# Verify branch-count guard: all required branches fired.
# Returns 0 if OK, 1 if any required branch missing (also sets RESULT=HARNESS_ERROR).
swsp_check_branch_counts() {
  local fake_log="$1"
  local ptc pc cc wc
  ptc="$(grep -c "branch=parent-tool-call" "$fake_log" 2>/dev/null | tr -d '[:space:]')"; ptc="${ptc:-0}"
  pc="$(grep -c "branch=parent-hold" "$fake_log" 2>/dev/null | tr -d '[:space:]')"; pc="${pc:-0}"
  cc="$(grep -c "branch=child" "$fake_log" 2>/dev/null | tr -d '[:space:]')"; cc="${cc:-0}"
  wc="$(grep -c "branch=wake" "$fake_log" 2>/dev/null | tr -d '[:space:]')"; wc="${wc:-0}"
  ptc="${ptc%%[!0-9]*}"; pc="${pc%%[!0-9]*}"; cc="${cc%%[!0-9]*}"; wc="${wc%%[!0-9]*}"
  ptc="${ptc:-0}"; pc="${pc:-0}"; cc="${cc:-0}"; wc="${wc:-0}"

  swsp_info "branch counts: parent-tool-call=$ptc parent-hold=$pc child=$cc wake=$wc"

  if [ "$ptc" -lt 1 ] || [ "$pc" -lt 1 ] || [ "$cc" -lt 1 ] || [ "$wc" -lt 1 ]; then
    printf 'RESULT=HARNESS_ERROR branch_counts parent-tool-call=%s parent-hold=%s child=%s wake=%s\n' \
      "$ptc" "$pc" "$cc" "$wc"
    return 1
  fi
  return 0
}

# ---- self-test ---------------------------------------------------------------
swsp_self_test() {
  swsp_info "running self-test..."
  local fails=0

  # Deps
  oqa_require opencode sqlite3 curl jq bun || { swsp_log "FAIL: missing dependencies"; fails=$((fails+1)); }

  # Start fake-LLM
  local st_log
  st_log="$(mktemp -t swsp-st-llm.XXXXXX)"
  OQA_TMPDIRS+=("$st_log")

  if ! swsp_start_fake_llm "$st_log"; then
    swsp_log "FAIL: fake-LLM did not start (port=${FAKE_OPENAI_PORT:-dynamic})"
    fails=$((fails+1))
  else
    swsp_info "fake-LLM started on port $FAKE_SERVER_PORT"

    # Health check
    if curl -sf "http://127.0.0.1:${FAKE_SERVER_PORT}/health" >/dev/null 2>&1; then
      swsp_info "PASS: fake-LLM /health 200"
    else
      swsp_log "FAIL: fake-LLM /health did not return 200"
      fails=$((fails+1))
    fi
  fi

  # Sandbox + opencode serve
  if ! oqa_start_server; then
    swsp_log "FAIL: opencode serve did not start"
    swsp_stop_fake_llm
    fails=$((fails+1))
  else
    swsp_info "PASS: opencode serve started at $OQA_SERVER_URL"

    # /global/health check
    local health_code
    health_code="$(curl -so /dev/null -w "%{http_code}" -u "opencode:${OQA_SERVER_PASS}" \
      "${OQA_SERVER_URL}/global/health" 2>/dev/null)" || true
    if [ "$health_code" = "200" ]; then
      swsp_info "PASS: /global/health 200"
    else
      swsp_log "FAIL: /global/health returned $health_code"
      fails=$((fails+1))
    fi

    # OMO_SANDBOX_OMO_CONFIG env contract assertion: merge keeps base overrides
    local omo_cfg_path="$XDG_CONFIG_HOME/opencode/oh-my-openagent.json"
    OMO_SANDBOX_OMO_CONFIG='{"_probe":true}' swsp_write_omo_config "$XDG_CONFIG_HOME"
    local probe_val explore_model
    probe_val="$(jq -r '._probe' "$omo_cfg_path" 2>/dev/null)"
    explore_model="$(jq -r '.agents.explore.model' "$omo_cfg_path" 2>/dev/null)"
    if [ "$probe_val" = "true" ] && [ "$explore_model" = "openai/gpt-fake" ]; then
      swsp_info "PASS: OMO_SANDBOX_OMO_CONFIG merge assertion (env key + base overrides both present)"
    else
      swsp_log "FAIL: omo config merge wrong: _probe='$probe_val' explore_model='$explore_model'"
      fails=$((fails+1))
    fi
  fi

  swsp_stop_fake_llm

  # Orphan check
  local orphan_count
  orphan_count="$(pgrep -f "fake-openai-server" 2>/dev/null | wc -l | tr -d ' ')" || orphan_count=0
  if [ "${orphan_count:-0}" -eq 0 ]; then
    swsp_info "PASS: no orphan fake-openai-server processes"
  else
    swsp_log "FAIL: $orphan_count orphan fake-openai-server process(es) remain"
    pkill -f "fake-openai-server" 2>/dev/null || true
    fails=$((fails+1))
  fi

  if [ "$fails" -eq 0 ]; then
    printf 'SELF-TEST OK\n'
    return 0
  fi
  printf 'SELF-TEST FAILED (%d failure(s))\n' "$fails" >&2
  return 1
}

# ---- main probe run ----------------------------------------------------------
swsp_run_probe() {
  local evidence_dir="${EVIDENCE_DIR:-$(mktemp -d -t swsp-evidence.XXXXXX)}"
  mkdir -p "$evidence_dir"
  OQA_TMPDIRS+=("$evidence_dir") 2>/dev/null || true  # only auto-clean if we created it

  # Override: if caller gave --evidence-dir, don't delete it
  if [ -n "$EVIDENCE_DIR" ]; then
    # Remove from cleanup list (last element we added)
    unset 'OQA_TMPDIRS[${#OQA_TMPDIRS[@]}-1]' 2>/dev/null || true
  fi

  swsp_info "evidence dir: $evidence_dir"

  local fake_llm_log="$evidence_dir/fake-llm.log"
  local harness_log="$evidence_dir/harness.log"
  local serve_stdout="$evidence_dir/opencode-serve.stdout"
  local serve_stderr="$evidence_dir/opencode-serve.stderr"

  # Step 1: Record real-DB session count (read-only)
  local real_db_path real_db_count_before
  real_db_path="$(opencode db path 2>/dev/null | head -1 || echo "")"
  if [ -n "$real_db_path" ] && [ -f "$real_db_path" ]; then
    real_db_count_before="$(sqlite3 "$real_db_path" 'SELECT count(*) FROM session' 2>/dev/null || echo "0")"
  else
    real_db_count_before="0"
    real_db_path="(not found)"
  fi
  swsp_info "real DB session count before: $real_db_count_before"
  printf 'real_db=%s before=%s\n' "$real_db_path" "$real_db_count_before" >"$evidence_dir/isolation-receipt.txt"

  # Capture omo log byte offset
  local omo_log="${TMPDIR:-/tmp}/oh-my-opencode.log"
  local omo_log_offset
  if [ -f "$omo_log" ]; then
    omo_log_offset="$(wc -c <"$omo_log" 2>/dev/null | tr -d ' ')" || omo_log_offset=0
  else
    omo_log_offset=0
  fi

  # Step 2: Start fake-openai server
  swsp_info "starting fake-openai server..."
  if ! swsp_start_fake_llm "$fake_llm_log"; then
    swsp_log "HARNESS_ERROR: fake-openai server failed to start"
    printf 'RESULT=HARNESS_ERROR fake_llm_start_failed\n' | tee -a "$harness_log"
    return 1
  fi
  swsp_info "fake-openai on port $FAKE_SERVER_PORT"
  printf 'fake_llm_port=%s\n' "$FAKE_SERVER_PORT" >>"$evidence_dir/isolation-receipt.txt"

  # Step 3: Create isolated sandbox and write opencode.jsonc
  # oqa_mk_isolated_xdg sets XDG_CONFIG_HOME, XDG_DATA_HOME, etc.
  oqa_mk_isolated_xdg
  swsp_info "sandbox: $OQA_XDG_ROOT"

  swsp_write_omo_config "$XDG_CONFIG_HOME"

  swsp_write_opencode_config "$XDG_CONFIG_HOME" "$FAKE_SERVER_PORT"
  local sandbox_db="$XDG_DATA_HOME/opencode/opencode.db"

  # Step 4: Start opencode serve (using oqa_start_server internals but with our config)
  # oqa_start_server includes another oqa_mk_isolated_xdg call which would reset XDG vars.
  # Instead, start server directly using the already-set XDG vars.
  swsp_info "starting opencode serve..."
  local port pass
  port="$(oqa_free_port)"
  pass="oqa-${RANDOM}${RANDOM}"

  OPENCODE_SERVER_PASSWORD="$pass" opencode serve --port "$port" --hostname 127.0.0.1 \
    >"$serve_stdout" 2>"$serve_stderr" &
  OQA_SERVER_PID=$!
  disown "$OQA_SERVER_PID" 2>/dev/null || true
  export OQA_SERVER_PORT="$port"
  export OQA_SERVER_PASS="$pass"
  export OQA_SERVER_URL="http://127.0.0.1:$port"

  if ! oqa_wait_http "$OQA_SERVER_URL/global/health" "opencode:$pass" 30; then
    swsp_log "HARNESS_ERROR: opencode serve failed to start"
    cat "$serve_stderr" >&2 2>/dev/null || true
    printf 'RESULT=HARNESS_ERROR opencode_serve_start_failed\n' | tee -a "$harness_log"
    swsp_stop_fake_llm
    return 1
  fi
  swsp_info "opencode serve ready at $OQA_SERVER_URL"

  # Encode the working directory for use in URL
  local enc_dir
  enc_dir="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$OQA_PROJ" 2>/dev/null \
    || printf '%s' "$OQA_PROJ" | sed 's|/|%2F|g')"

  # Step 5: Create a session
  swsp_info "creating session..."
  local ses_response ses_id
  ses_response="$(curl -sS -u "opencode:${pass}" \
    -X POST "${OQA_SERVER_URL}/session?directory=${enc_dir}" \
    -H 'content-type: application/json' \
    -d '{"title":"wake split probe"}' 2>/dev/null)" || ses_response=""

  ses_id="$(printf '%s' "$ses_response" | jq -r '.id // .sessionID // empty' 2>/dev/null)" || ses_id=""

  if [ -z "$ses_id" ]; then
    swsp_log "HARNESS_ERROR: could not create session (response: $ses_response)"
    printf 'RESULT=HARNESS_ERROR session_create_failed\n' | tee -a "$harness_log"
    swsp_stop_fake_llm
    return 1
  fi
  swsp_info "session: $ses_id"
  printf 'session_id=%s\n' "$ses_id" >>"$evidence_dir/isolation-receipt.txt"

  # Step 6: Send the split probe prompt
  swsp_info "sending split probe prompt..."
  local prompt_response
  prompt_response="$(curl -sS -u "opencode:${pass}" \
    -X POST "${OQA_SERVER_URL}/session/${ses_id}/prompt_async?directory=${enc_dir}" \
    -H 'content-type: application/json' \
    -d '{"parts":[{"type":"text","text":"Run the split probe: call call_omo_agent exactly once as instructed, then run the bash hold command."}]}' \
    2>/dev/null)" || prompt_response=""
  swsp_info "prompt_async response: $prompt_response"

  # Step 7: Poll sandbox DB for children/stops; also wait for session idle
  swsp_info "polling DB for wake-split metrics (up to 120s)..."
  local metrics
  metrics="$(swsp_poll_db_metrics "$sandbox_db" '%[BACKGROUND TASK%' 120)"
  local children stops
  children="$(printf '%s' "$metrics" | awk '{print $1}')"
  stops="$(printf '%s' "$metrics" | awk '{print $2}')"
  children="${children:-0}"
  stops="${stops:-0}"
  swsp_info "DB metrics: children=$children stops=$stops"

  # Wait for parent session to go idle
  swsp_info "waiting for parent session to go idle..."
  swsp_wait_session_idle "$OQA_SERVER_URL" "$pass" "$ses_id" 60

  # Re-read metrics after idle
  metrics="$(swsp_poll_db_metrics "$sandbox_db" '%[BACKGROUND TASK%' 10)"
  children="$(printf '%s' "$metrics" | awk '{print $1}')"
  stops="$(printf '%s' "$metrics" | awk '{print $2}')"
  children="${children:-0}"
  stops="${stops:-0}"
  swsp_info "final DB metrics: children=$children stops=$stops"
  printf 'children=%s stops=%s\n' "$children" "$stops" >"$evidence_dir/marker-metrics.txt"

  # Step 8: Plugin-init count
  local plugin_inits
  plugin_inits="$(swsp_count_plugin_inits "$omo_log_offset" "$OQA_PROJ")"
  plugin_inits="${plugin_inits:-0}"
  swsp_info "plugin_inits: $plugin_inits"
  printf '%s\n' "$plugin_inits" >"$evidence_dir/plugin-init-count.txt"

  # Step 9: Route provenance
  local route_prov=""
  if [ -f "$omo_log" ]; then
    route_prov="$(tail -c "+$((omo_log_offset + 1))" "$omo_log" 2>/dev/null \
      | grep -E "live-server-route" || true)"
  fi
  printf '%s\n' "$route_prov" >"$evidence_dir/route-provenance.log"
  swsp_info "route-provenance lines: $(printf '%s' "$route_prov" | wc -l | tr -d ' ')"

  # WAKE_DISPATCHED_DURING_PARENT_TURN mechanism signal
  local wake_during_parent
  wake_during_parent="$(swsp_detect_wake_during_parent "$omo_log_offset" "$fake_llm_log" "$OQA_PROJ")"
  swsp_info "WAKE_DISPATCHED_DURING_PARENT_TURN=$wake_during_parent"

  # Step 10: Branch-count guard
  if ! swsp_check_branch_counts "$fake_llm_log" >&2; then
    # Branch counts not met — HARNESS_ERROR
    local ptc pc cc wc
    ptc="$(grep -c "branch=parent-tool-call" "$fake_llm_log" 2>/dev/null || printf '0')"
    pc="$(grep -c "branch=parent-hold" "$fake_llm_log" 2>/dev/null || printf '0')"
    cc="$(grep -c "branch=child" "$fake_llm_log" 2>/dev/null || printf '0')"
    wc="$(grep -c "branch=wake" "$fake_llm_log" 2>/dev/null || printf '0')"
    local verdict_line
    verdict_line="RESULT=HARNESS_ERROR children=${children} stops=${stops} plugin_inits=${plugin_inits} WAKE_DISPATCHED_DURING_PARENT_TURN=${wake_during_parent} branch_counts=parent-tool-call:${ptc},parent-hold:${pc},child:${cc},wake:${wc}"
    printf '%s\n' "$verdict_line" | tee -a "$harness_log"
    swsp_stop_fake_llm
    return 1
  fi

  # Step 11: Determine verdict
  local result="INCONCLUSIVE"
  local exit_code=1

  # Arm 1: SQLite evidence (stops>1 or children>1)
  if [ "${stops:-0}" -gt 1 ] || [ "${children:-0}" -gt 1 ] 2>/dev/null; then
    result="REPRODUCED"
  fi

  # Arm 2: Mechanism signal (wake dispatched during parent turn + in-process path)
  # in-process path: no live-server-route dispatch line for this wake
  local has_live_dispatch=false
  if printf '%s' "$route_prov" | grep -q "dispatch via live listener" 2>/dev/null; then
    has_live_dispatch=true
  fi
  if [ "$wake_during_parent" = "true" ] && [ "$has_live_dispatch" = "false" ]; then
    result="REPRODUCED"
  fi

  # FIXED: exactly 1 child and 1 stop, and neither REPRODUCED arm held
  if [ "$result" = "INCONCLUSIVE" ] && [ "${children:-0}" -eq 1 ] && [ "${stops:-0}" -eq 1 ] 2>/dev/null; then
    result="FIXED"
  fi

  local verdict_line
  verdict_line="RESULT=${result} children=${children} stops=${stops} plugin_inits=${plugin_inits} WAKE_DISPATCHED_DURING_PARENT_TURN=${wake_during_parent}"
  printf '%s\n' "$verdict_line" | tee -a "$harness_log"

  # Determine exit code based on expected mode
  if [ -n "$EXPECT_MODE" ]; then
    if [ "$EXPECT_MODE" = "reproduced" ] && [ "$result" = "REPRODUCED" ]; then
      exit_code=0
    elif [ "$EXPECT_MODE" = "fixed" ] && [ "$result" = "FIXED" ]; then
      exit_code=0
    else
      exit_code=1
    fi
  else
    exit_code=0  # no expectation: just report
  fi

  # Step 12: Isolation receipt — verify real DB count unchanged
  local real_db_count_after=""
  if [ -n "$real_db_path" ] && [ "$real_db_path" != "(not found)" ] && [ -f "$real_db_path" ]; then
    real_db_count_after="$(sqlite3 "$real_db_path" 'SELECT count(*) FROM session' 2>/dev/null || echo "0")"
  else
    real_db_count_after="$real_db_count_before"
  fi
  printf 'after=%s unchanged=%s\n' \
    "$real_db_count_after" \
    "$([ "$real_db_count_after" = "$real_db_count_before" ] && echo yes || echo NO)" \
    >>"$evidence_dir/isolation-receipt.txt"
  swsp_info "isolation: real DB before=$real_db_count_before after=$real_db_count_after"

  # Preserve the sandbox DB for post-hoc inspection before the trap removes it
  sqlite3 "$sandbox_db" ".backup '$evidence_dir/sandbox-opencode.db'" 2>/dev/null || true

  # Cleanup receipt
  swsp_stop_fake_llm
  printf 'fake_llm=stopped opencode_serve=stopping\n' >"$evidence_dir/cleanup-receipt.txt"

  # Orphan check
  local orphan_count
  orphan_count="$(pgrep -f "fake-openai-server" 2>/dev/null | wc -l | tr -d ' ')" || orphan_count=0
  if [ "${orphan_count:-0}" -gt 0 ]; then
    swsp_log "WARNING: $orphan_count orphan fake-openai-server process(es); killing"
    pkill -f "fake-openai-server" 2>/dev/null || true
  fi
  printf 'orphan_fake_llm=%s\n' "${orphan_count:-0}" >>"$evidence_dir/cleanup-receipt.txt"

  return "$exit_code"
}

# ---- dispatch ----------------------------------------------------------------
if [ "$SELF_TEST" -eq 1 ]; then
  swsp_self_test
  exit $?
fi

swsp_run_probe
exit $?
