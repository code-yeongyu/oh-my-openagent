#!/usr/bin/env bash
# 4035 root-cause probe: does `opencode attach --dir X` stop applying live
# message updates when the session's directory differs from X?
# Isolated XDG sandbox; no tmux needed (pty via `script`).
set -u
QA=/tmp/opencode/4035-qa
rm -rf "$QA"
mkdir -p "$QA/data" "$QA/config" "$QA/state" "$QA/cache" "$QA/projA" "$QA/wtB" "$QA/out"

export XDG_DATA_HOME="$QA/data" XDG_CONFIG_HOME="$QA/config" \
       XDG_STATE_HOME="$QA/state" XDG_CACHE_HOME="$QA/cache"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
PORT=4599
URL="http://127.0.0.1:$PORT"

cd "$QA/projA"
opencode serve --port "$PORT" --hostname 127.0.0.1 > "$QA/out/serve.log" 2>&1 &
SERVE_PID=$!
for i in $(seq 1 50); do
  curl -sf -m 3 "$URL/project/current" >/dev/null 2>&1 && break
  sleep 0.3
done
echo "server up (pid $SERVE_PID)"

create_session() { # $1 = directory
  curl -sf -m 3 -X POST "$URL/session?directory=$1" -H 'content-type: application/json' -d '{"title":"pane-freeze-probe"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1
}
send_prompt() { # $1 = session, $2 = directory, $3 = text
  curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/session/$1/message?directory=$2" \
    -H 'content-type: application/json' \
    -d "{\"agent\":\"build\",\"model\":{\"providerID\":\"noop-provider\",\"modelID\":\"noop-model\"},\"tools\":{},\"parts\":[{\"type\":\"text\",\"text\":\"$3\"}]}"
}
msg_count() { # $1 = session, $2 = directory
  curl -sf -m 3 "$URL/session/$1/message?directory=$2" | grep -o '"id":"msg_' | wc -l
}

run_case() { # $1=case-name  $2=attach-dir  $3=session-dir
  local name="$1" attach_dir="$2" sess_dir="$3"
  local sid; sid=$(create_session "$sess_dir")
  echo "[$name] session=$sid attach_dir=$attach_dir sess_dir=$sess_dir"
  echo "[$name] prompt1 http=$(send_prompt "$sid" "$sess_dir" "FIRSTMSG-$name-one")"
  sleep 1
  # attach under pty, detached
  nohup script -qefc "opencode attach $URL --session $sid --dir $attach_dir" "$QA/out/attach-$name.log" >/dev/null 2>&1 &
  echo $! > "$QA/out/attach-$name.pid"
  sleep 6
  echo "[$name] prompt2 http=$(send_prompt "$sid" "$sess_dir" "SECONDMSG-$name-two")"
  sleep 8
  kill "$(cat "$QA/out/attach-$name.pid")" 2>/dev/null
  pkill -f "opencode attach $URL --session $sid" 2>/dev/null
  sleep 1
  echo "[$name] api msg count=$(msg_count "$sid" "$sess_dir")"
  echo "[$name] FIRSTMSG rendered: $(grep -c "FIRSTMSG-$name-one" "$QA/out/attach-$name.log")"
  echo "[$name] SECONDMSG rendered: $(grep -c "SECONDMSG-$name-two" "$QA/out/attach-$name.log")"
}

run_case match   "$QA/projA" "$QA/projA"
run_case mismatch "$QA/wtB" "$QA/projA"

kill "$SERVE_PID" 2>/dev/null
echo done
