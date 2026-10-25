#!/usr/bin/env bash
# Real OpenCode HTTP QA for OMO #8469.
#
# This driver loads the worktree plugin from source, starts one strictly
# isolated `opencode serve` process per model, and inspects GET /agent. Raw
# prompts and server logs never leave the temporary sandbox. Persisted output
# is limited to classifications, model ids, byte counts, hashes, status codes,
# versions, and cleanup/isolation receipts.
set -euo pipefail

REPO="${1:?worktree root required}"
EVIDENCE_DIR="${2:?evidence output directory required}"

mkdir -p "$EVIDENCE_DIR"
CLASSIFICATIONS="$EVIDENCE_DIR/classifications.tsv"
CLEANUP_RECEIPT="$EVIDENCE_DIR/isolation-cleanup.txt"

HOST_DB_PATH="$(opencode db path)"
OPENCODE_VERSION="$(opencode --version)"
HOST_DB_BEFORE="$(sqlite3 "$HOST_DB_PATH" 'SELECT count(*) FROM session;')"

if ! [[ "$HOST_DB_BEFORE" =~ ^[0-9]+$ ]]; then
  echo "fatal=host-db-before-not-numeric" >&2
  exit 2
fi

SANDBOX="$(mktemp -d -t omo-kimi-k3-256k-qa.XXXXXX)"
case "$SANDBOX" in
  /tmp/omo-kimi-k3-256k-qa.*) ;;
  *)
    echo "fatal=unexpected-sandbox-path" >&2
    exit 2
    ;;
esac

ACTIVE_PID=""
ACTIVE_WINPID=""
ACTIVE_PORT=""
PASS_COUNT=0
FAIL_COUNT=0

force_cleanup() {
  if [[ -n "$ACTIVE_PID" ]]; then
    if [[ -n "$ACTIVE_WINPID" ]]; then
      taskkill.exe //PID "$ACTIVE_WINPID" //T //F >/dev/null 2>&1 || true
    fi
    kill "$ACTIVE_PID" >/dev/null 2>&1 || true
    wait "$ACTIVE_PID" >/dev/null 2>&1 || true
  fi
  ACTIVE_PID=""
  ACTIVE_WINPID=""
  ACTIVE_PORT=""
  if [[ -n "${SANDBOX:-}" && -d "$SANDBOX" ]]; then
    rm -rf -- "$SANDBOX"
  fi
}
trap force_cleanup EXIT INT TERM

export HOME="$SANDBOX/home"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_STATE_HOME="$SANDBOX/state"
export XDG_CACHE_HOME="$SANDBOX/cache"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
export OMO_DISABLE_TELEMETRY=1
export DO_NOT_TRACK=1
unset ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY GEMINI_API_KEY MOONSHOT_API_KEY || true

PROJECT="$SANDBOX/project"
mkdir -p \
  "$HOME/.omo" \
  "$XDG_DATA_HOME" \
  "$XDG_CONFIG_HOME/opencode" \
  "$XDG_STATE_HOME" \
  "$XDG_CACHE_HOME" \
  "$PROJECT"

REPO_URL_PATH="$(cygpath -m "$REPO")"
PROJECT_WIN="$(cygpath -w "$PROJECT")"

cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["file://$REPO_URL_PATH/packages/omo-opencode/src/index.ts"]
}
EOF

printf 'scenario\tmodel\thttp_status\tagent\truntime_name\tresolved_model\tclassification\tprompt_bytes\tprompt_sha256\n' \
  > "$CLASSIFICATIONS"

printf '%s\n' \
  "opencode_version=$OPENCODE_VERSION" \
  'host_db_path=<HOST_OPENCODE_DB>' \
  "host_db_session_count_before=$HOST_DB_BEFORE" \
  'sandbox_path=<TEMP_SANDBOX>' \
  'home_isolated=true' \
  'xdg_data_isolated=true' \
  'xdg_config_isolated=true' \
  'xdg_state_isolated=true' \
  'xdg_cache_isolated=true' \
  'autoupdate_disabled=true' \
  'models_fetch_disabled=true' \
  > "$CLEANUP_RECEIPT"

record_assertion() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "assertion=PASS label=$label actual=$actual"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "assertion=FAIL label=$label expected=$expected actual=$actual"
  fi
}

classify_sisyphus() {
  local prompt_file="$1"
  if grep -Fq 'running on Kimi K3' "$prompt_file"; then
    echo 'kimi-k3'
  elif grep -Fq 'running on Kimi K2.7' "$prompt_file"; then
    echo 'kimi-k2-7'
  elif grep -Fq 'Powerful AI Agent with orchestration capabilities' "$prompt_file"; then
    echo 'default'
  else
    echo 'other'
  fi
}

classify_junior() {
  local prompt_file="$1"
  if grep -Fq 'running on Kimi K3' "$prompt_file"; then
    echo 'kimi-k3'
  elif grep -Fq 'running on Kimi K2.7' "$prompt_file"; then
    echo 'kimi-k2-7'
  elif grep -Fq 'Sisyphus-Junior - Focused executor from OhMyOpenCode.' "$prompt_file"; then
    echo 'default'
  else
    echo 'other'
  fi
}

classify_atlas() {
  local prompt_file="$1"
  if grep -Fq 'running on Kimi K3' "$prompt_file"; then
    echo 'kimi-k3'
  elif grep -Fq 'running on Kimi K2.7' "$prompt_file"; then
    echo 'kimi-k2-7'
  elif grep -Fq 'You are Atlas - the Master Orchestrator from OhMyOpenCode.' "$prompt_file"; then
    echo 'default'
  else
    echo 'other'
  fi
}

classify_metis() {
  local prompt_file="$1"
  if grep -Fq 'running on Kimi K2.7' "$prompt_file"; then
    echo 'kimi-k2-7'
  elif grep -Fq '# Metis - Pre-Planning Consultant' "$prompt_file"; then
    echo 'base'
  else
    echo 'other'
  fi
}

extract_agent() {
  local scenario="$1"
  local model="$2"
  local http_status="$3"
  local agent_key="$4"
  local runtime_name="$5"
  local expected_class="$6"
  local classifier="$7"
  local agents_json="$8"

  local prompt_file="$SANDBOX/${scenario}-${agent_key}.prompt"
  jq -j --arg name "$runtime_name" '[.[] | select(.name == $name)][0].prompt // ""' "$agents_json" > "$prompt_file"

  local resolved_model
  resolved_model="$(
    jq -r --arg name "$runtime_name" '
      [.[] | select(.name == $name)][0].model
      | if type == "string" then .
        elif type == "object" then "\(.providerID)/\(.modelID)"
        else "<missing>"
        end
    ' "$agents_json"
  )"

  local classification
  classification="$($classifier "$prompt_file")"
  local prompt_bytes
  prompt_bytes="$(wc -c < "$prompt_file" | tr -d '[:space:]')"
  local prompt_sha256
  prompt_sha256="$(sha256sum "$prompt_file" | awk '{print $1}')"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$scenario" "$model" "$http_status" "$agent_key" "$runtime_name" \
    "$resolved_model" "$classification" "$prompt_bytes" "$prompt_sha256" \
    >> "$CLASSIFICATIONS"

  record_assertion "$scenario.$agent_key.resolved_model" "$resolved_model" "$model"
  record_assertion "$scenario.$agent_key.classification" "$classification" "$expected_class"
}

stop_server() {
  local scenario="$1"
  local pid="$ACTIVE_PID"
  local winpid="$ACTIVE_WINPID"
  local port="$ACTIVE_PORT"

  local taskkill_result='not-needed'
  if kill -0 "$pid" >/dev/null 2>&1; then
    if [[ -n "$winpid" ]] && taskkill.exe //PID "$winpid" //T //F >/dev/null 2>&1; then
      taskkill_result='tree-terminated'
    else
      kill "$pid" >/dev/null 2>&1 || true
      taskkill_result='fallback-kill'
    fi
  fi
  wait "$pid" >/dev/null 2>&1 || true

  local pid_gone='false'
  local winpid_gone='false'
  local port_http_closed='false'
  local port_listener_gone='false'
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      pid_gone='true'
    fi
    if [[ -n "$winpid" ]] && ! tasklist.exe //FI "PID eq $winpid" //FO CSV //NH 2>/dev/null | grep -Fq "\",\"$winpid\",\""; then
      winpid_gone='true'
    fi
    if ! curl -fsS --max-time 1 "http://127.0.0.1:$port/global/health" >/dev/null 2>&1; then
      port_http_closed='true'
    fi
    if ! netstat.exe -ano 2>/dev/null | awk -v port=":$port" '$1 == "TCP" && $2 ~ (port "$") && $4 == "LISTENING" { found=1 } END { exit found ? 0 : 1 }'; then
      port_listener_gone='true'
    fi
    if [[ "$pid_gone" == 'true' && "$winpid_gone" == 'true' && "$port_http_closed" == 'true' && "$port_listener_gone" == 'true' ]]; then
      break
    fi
    sleep 0.25
  done

  printf '%s\n' \
    "server_cleanup scenario=$scenario msys_pid=$pid winpid=$winpid port=$port method=$taskkill_result pid_gone=$pid_gone winpid_gone=$winpid_gone port_http_closed=$port_http_closed port_listener_gone=$port_listener_gone" \
    | tee -a "$CLEANUP_RECEIPT"

  record_assertion "$scenario.cleanup.pid_gone" "$pid_gone" 'true'
  record_assertion "$scenario.cleanup.winpid_gone" "$winpid_gone" 'true'
  record_assertion "$scenario.cleanup.port_http_closed" "$port_http_closed" 'true'
  record_assertion "$scenario.cleanup.port_listener_gone" "$port_listener_gone" 'true'

  ACTIVE_PID=""
  ACTIVE_WINPID=""
  ACTIVE_PORT=""
}

run_scenario() {
  local scenario="$1"
  local model="$2"
  local expected_sisyphus="$3"
  local expected_junior="$4"
  local expected_atlas="$5"
  local expected_metis="$6"

  cat > "$HOME/.omo/omo.jsonc" <<EOF
{
  "agents": {
    "sisyphus": { "model": "$model" },
    "sisyphus-junior": { "model": "$model" },
    "atlas": { "model": "$model" },
    "metis": { "model": "$model" }
  }
}
EOF

  local server_log="$SANDBOX/$scenario-serve.log"
  (
    cd "$PROJECT"
    exec opencode serve --port 0 --hostname 127.0.0.1
  ) > "$server_log" 2>&1 &
  ACTIVE_PID=$!
  ACTIVE_WINPID=""
  ACTIVE_PORT=""

  for _ in $(seq 1 90); do
    ACTIVE_PORT="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$server_log" | head -1 | grep -oE '[0-9]+$' || true)"
    [[ -n "$ACTIVE_PORT" ]] && break
    if ! kill -0 "$ACTIVE_PID" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if [[ -z "$ACTIVE_PORT" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "assertion=FAIL label=$scenario.server_listened expected=true actual=false"
    ACTIVE_WINPID="$(ps -W | awk -v pid="$ACTIVE_PID" '$1 == pid { print $4; exit }')"
    if [[ -n "$ACTIVE_WINPID" ]]; then
      taskkill.exe //PID "$ACTIVE_WINPID" //T //F >/dev/null 2>&1 || true
    fi
    kill "$ACTIVE_PID" >/dev/null 2>&1 || true
    wait "$ACTIVE_PID" >/dev/null 2>&1 || true
    ACTIVE_PID=""
    ACTIVE_WINPID=""
    return
  fi

  ACTIVE_WINPID="$(ps -W | awk -v pid="$ACTIVE_PID" '$1 == pid { print $4; exit }')"
  record_assertion "$scenario.server_winpid_captured" "$([[ -n "$ACTIVE_WINPID" ]] && echo true || echo false)" 'true'
  echo "server_started scenario=$scenario msys_pid=$ACTIVE_PID winpid=$ACTIVE_WINPID port=$ACTIVE_PORT model=$model"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "assertion=PASS label=$scenario.server_listened actual=true"

  local health_json="$SANDBOX/$scenario-health.json"
  local health_status
  health_status="$(curl -sS --max-time 30 -o "$health_json" -w '%{http_code}' "http://127.0.0.1:$ACTIVE_PORT/global/health")"
  record_assertion "$scenario.health.http_status" "$health_status" '200'
  local health_healthy
  health_healthy="$(jq -r '.healthy // false' "$health_json")"
  local health_version
  health_version="$(jq -r '.version // "<missing>"' "$health_json")"
  record_assertion "$scenario.health.healthy" "$health_healthy" 'true'
  record_assertion "$scenario.health.version" "$health_version" "$OPENCODE_VERSION"

  local agents_json="$SANDBOX/$scenario-agents.json"
  local agent_status
  agent_status="$(
    curl -sS --max-time 45 \
      -H "x-opencode-directory: $PROJECT_WIN" \
      -o "$agents_json" \
      -w '%{http_code}' \
      "http://127.0.0.1:$ACTIVE_PORT/agent"
  )"
  record_assertion "$scenario.agent.http_status" "$agent_status" '200'

  local json_is_array='false'
  if jq -e 'type == "array"' "$agents_json" >/dev/null 2>&1; then
    json_is_array='true'
  fi
  record_assertion "$scenario.agent.json_array" "$json_is_array" 'true'

  extract_agent "$scenario" "$model" "$agent_status" \
    'sisyphus' 'Sisyphus - ultraworker' "$expected_sisyphus" classify_sisyphus "$agents_json"
  extract_agent "$scenario" "$model" "$agent_status" \
    'sisyphus-junior' 'Sisyphus-Junior' "$expected_junior" classify_junior "$agents_json"
  extract_agent "$scenario" "$model" "$agent_status" \
    'atlas' 'Atlas - Plan Executor' "$expected_atlas" classify_atlas "$agents_json"
  extract_agent "$scenario" "$model" "$agent_status" \
    'metis' 'Metis - Plan Consultant' "$expected_metis" classify_metis "$agents_json"

  stop_server "$scenario"
}

echo 'invocation=bash qa-live-opencode.sh <WORKTREE> <EVIDENCE_DIR>'
echo "opencode_version=$OPENCODE_VERSION"
echo 'plugin_source=file://<WORKTREE>/packages/omo-opencode/src/index.ts'
echo 'surface=real-opencode-serve GET-/global/health GET-/agent'
echo "host_db_session_count_before=$HOST_DB_BEFORE"
echo 'sandbox=<TEMP_SANDBOX>'

run_scenario 'target-k3-256k' 'kimi-for-coding/k3-256k' 'kimi-k3' 'kimi-k3' 'kimi-k3' 'base'
run_scenario 'positive-k3' 'opencode-go/kimi-k3' 'kimi-k3' 'kimi-k3' 'kimi-k3' 'base'
run_scenario 'k2-control' 'opencode-go/kimi-k2.7-code' 'kimi-k2-7' 'kimi-k2-7' 'kimi-k2-7' 'kimi-k2-7'
run_scenario 'default-control' 'anthropic/claude-sonnet-5' 'default' 'default' 'default' 'base'

TARGET_METIS_HASH="$(awk -F '\t' '$1 == "target-k3-256k" && $4 == "metis" { print $9 }' "$CLASSIFICATIONS")"
POSITIVE_METIS_HASH="$(awk -F '\t' '$1 == "positive-k3" && $4 == "metis" { print $9 }' "$CLASSIFICATIONS")"
record_assertion 'k3.metis.base_prompt_hash_match' "$TARGET_METIS_HASH" "$POSITIVE_METIS_HASH"

rm -rf -- "$SANDBOX"
SANDBOX_REMOVED='false'
if [[ ! -e "$SANDBOX" ]]; then
  SANDBOX_REMOVED='true'
fi
record_assertion 'sandbox.removed' "$SANDBOX_REMOVED" 'true'

HOST_DB_AFTER="$(sqlite3 "$HOST_DB_PATH" 'SELECT count(*) FROM session;')"
record_assertion 'host_db.session_count_unchanged' "$HOST_DB_AFTER" "$HOST_DB_BEFORE"

printf '%s\n' \
  "sandbox_removed=$SANDBOX_REMOVED" \
  "host_db_session_count_after=$HOST_DB_AFTER" \
  "host_db_session_count_unchanged=$([[ "$HOST_DB_AFTER" == "$HOST_DB_BEFORE" ]] && echo true || echo false)" \
  "assertions_passed=$PASS_COUNT" \
  "assertions_failed=$FAIL_COUNT" \
  >> "$CLEANUP_RECEIPT"

trap - EXIT INT TERM
echo "host_db_session_count_after=$HOST_DB_AFTER"
echo "sandbox_removed=$SANDBOX_REMOVED"
echo "assertions_passed=$PASS_COUNT assertions_failed=$FAIL_COUNT"

if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi
