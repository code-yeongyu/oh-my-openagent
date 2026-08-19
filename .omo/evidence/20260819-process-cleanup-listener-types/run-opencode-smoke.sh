#!/usr/bin/env bash
set -euo pipefail

worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
plugin_uri="file://$worktree/dist/index.js"
live_db="$(opencode db path 2>/dev/null | head -1)"
if [ -f "$live_db" ]; then
  before="$(sqlite3 "$live_db" 'SELECT count(*) FROM session;')"
else
  before="missing"
fi

. "$worktree/.agents/skills/opencode-qa/scripts/lib/common.sh"
oqa_mk_isolated_xdg
mkdir -p "$XDG_CONFIG_HOME/opencode"
printf '{"plugin":["%s"]}\n' "$plugin_uri" > "$XDG_CONFIG_HOME/opencode/opencode.json"

port="$(oqa_free_port)"
pass="oqa-$RANDOM$RANDOM"
url="http://127.0.0.1:$port"
OPENCODE_SERVER_PASSWORD="$pass" opencode serve --port "$port" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/serve.log" 2>&1 &
OQA_SERVER_PID=$!
disown "$OQA_SERVER_PID" 2>/dev/null || true
oqa_wait_http "$url/global/health" "opencode:$pass" 30

curl -fsS -u "opencode:$pass" --get --data-urlencode "directory=$OQA_PROJ" \
  "$url/config" > "$XDG_STATE_HOME/config.json"

curl -sN -u "opencode:$pass" --get --data-urlencode "directory=$OQA_PROJ" \
  "$url/event" > "$XDG_STATE_HOME/events.txt" 2>/dev/null &
watcher=$!
OQA_CURL_PIDS+=("$watcher")
deadline=$(( $(date +%s) + 15 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  grep -q '"type":"server.connected"' "$XDG_STATE_HOME/events.txt" && break
  sleep 0.2
done

agent_keys="$(jq -c '(.agent // .agents // {}) | keys' "$XDG_STATE_HOME/config.json")"
agent_present="$(jq -r '((.agent // .agents // {}) | keys | map(ascii_downcase) | any(contains("sisyphus")))' "$XDG_STATE_HOME/config.json")"
configured_plugins="$(jq -c '.plugin // .plugins // []' "$XDG_STATE_HOME/config.json")"
connected_events="$(grep -c '"type":"server.connected"' "$XDG_STATE_HOME/events.txt" || true)"
health="$(curl -fsS -u "opencode:$pass" "$url/global/health" | jq -c .)"

if [ -f "$live_db" ]; then
  after="$(sqlite3 "$live_db" 'SELECT count(*) FROM session;')"
else
  after="missing"
fi

printf 'surface=real opencode serve + /config + /event\n'
printf 'plugin_uri=%s\n' "$plugin_uri"
printf 'health=%s\n' "$health"
printf 'configured_plugins=%s\n' "$configured_plugins"
printf 'agent_keys=%s\n' "$agent_keys"
printf 'local_plugin_added_sisyphus=%s\n' "$agent_present"
printf 'server_connected_events=%s\n' "$connected_events"
printf 'live_db_session_count_before=%s\n' "$before"
printf 'live_db_session_count_after=%s\n' "$after"
printf 'live_db_unchanged=%s\n' "$([ "$before" = "$after" ] && echo true || echo false)"

[ "$agent_present" = "true" ]
[ "$connected_events" -ge 1 ]
[ "$before" = "$after" ]
