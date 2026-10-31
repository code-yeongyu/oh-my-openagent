#!/usr/bin/env bash
# Drives the real runtime-fallback session-timeout lifecycle end to end:
# isolated opencode server + our plugin + a fake provider that returns a
# retryable quota error and then goes silent (issue #6637 shape).
set -u

WORKTREE="/home/ac/Code/ahmet-cetinkaya/oh-my-openagent-6637"
OUT_DIR="/tmp/pr6669/qa"
SANDBOX="$(mktemp -d /tmp/pr6669-srv-XXXXXX)"

export HOME="$SANDBOX/home"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_STATE_HOME="$SANDBOX/state"
export XDG_CACHE_HOME="$SANDBOX/cache"
export TMPDIR="$SANDBOX/tmp"
mkdir -p "$HOME/.omo" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME/opencode" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY

rm -f "$OUT_DIR/hanging-provider.log" "$OUT_DIR/hanging-provider.port"
FAKE_LOG="$OUT_DIR/hanging-provider.log" node "$OUT_DIR/hanging-provider.mjs" > "$OUT_DIR/provider-stdout.txt" 2>&1 &
PROVIDER_PID=$!
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  kill "$PROVIDER_PID" 2>/dev/null
  sleep 1
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  [ -f "$OUT_DIR/hanging-provider.port" ] && break
  sleep 0.2
done
PORT="$(cat "$OUT_DIR/hanging-provider.port" 2>/dev/null || echo "")"
[ -z "$PORT" ] && { echo "FAIL: fake provider did not start"; exit 1; }
echo "SANDBOX=$SANDBOX"
echo "PROVIDER_PORT=$PORT"

export OPENAI_API_KEY="sk-fake-local-only"

cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["file://$WORKTREE/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-4o-mini",
  "provider": {
    "openai": {
      "options": { "baseURL": "http://127.0.0.1:$PORT/v1", "apiKey": "sk-fake-local-only" },
      "models": { "gpt-4o-mini": {}, "gpt-4o": {} }
    }
  }
}
JSON

cat > "$HOME/.omo/omo.jsonc" <<'JSON'
{
  "[opencode]": {
    "runtime_fallback": {
      "enabled": true,
      "max_fallback_attempts": 2,
      "cooldown_seconds": 1,
      "timeout_seconds": 5,
      "notify_on_fallback": true
    },
    "categories": {
      "quick": { "fallback_models": ["openai/gpt-4o"] }
    },
    "agents": {
      "sisyphus": { "fallback_models": ["openai/gpt-4o"] }
    }
  }
}
JSON

SRV_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
cd "$SANDBOX"
opencode serve --port "$SRV_PORT" --hostname 127.0.0.1 > "$OUT_DIR/server-stdout.txt" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$SRV_PORT"

for _ in $(seq 1 80); do
  curl -sf "$BASE/config" -o /dev/null 2>/dev/null && break
  sleep 0.5
done
echo "--- server up ---"
curl -sf "$BASE/config" -o /dev/null && echo "CONFIG_OK" || { echo "FAIL: server never became ready"; tail -20 "$OUT_DIR/server-stdout.txt"; exit 1; }

SESSION_JSON="$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"title":"runtime fallback timeout lifecycle"}' \
  "$BASE/session?directory=$SANDBOX")"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id??"")}catch{console.log("")}})')"
echo "SESSION_ID=$SESSION_ID"
[ -z "$SESSION_ID" ] && { echo "FAIL: no session id: $SESSION_JSON"; exit 1; }

echo "--- prompting the silent provider ---"
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"model":{"providerID":"openai","modelID":"gpt-4o-mini"},"parts":[{"type":"text","text":"say hi"}]}' \
  "$BASE/session/$SESSION_ID/prompt_async?directory=$SANDBOX" -o "$OUT_DIR/prompt-response.json" \
  --max-time 30
echo "PROMPT_CURL_EXIT=$?"

echo "--- waiting for the timeout lifecycle to run (bounded) ---"
for i in $(seq 1 60); do
  if grep -q "Session fallback exhausted" "$TMPDIR/oh-my-opencode.log" 2>/dev/null; then
    echo "EXHAUSTED_AFTER=${i}s"
    break
  fi
  curl -s --max-time 3 "$BASE/session/$SESSION_ID/message?directory=$SANDBOX" -o /dev/null 2>/dev/null
  sleep 1
done

echo "--- provider call log ---"
cat "$OUT_DIR/hanging-provider.log" 2>/dev/null

echo "--- runtime-fallback lifecycle lines ---"
grep -F "[runtime-fallback]" "$TMPDIR/oh-my-opencode.log" 2>/dev/null || echo "no runtime-fallback lines"
echo "--- prompt-async-gate lines ---"
grep -F "[prompt-async-gate]" "$TMPDIR/oh-my-opencode.log" 2>/dev/null | head -20 || echo "none"

echo "--- isolated session count ---"
ISO_DB="$XDG_DATA_HOME/opencode/opencode-stable.db"
if [ -f "$ISO_DB" ]; then sqlite3 "$ISO_DB" "SELECT count(*) FROM session;"; else echo "no isolated db"; fi

cp "$TMPDIR/oh-my-opencode.log" "$OUT_DIR/provider-server-plugin.log" 2>/dev/null || true
