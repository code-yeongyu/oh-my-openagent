#!/usr/bin/env bash
# Discriminating experiment: does the harness forward an agent's `temperature` into the
# outgoing request AT ALL, for a model that supports temperature?
#
# If YES -> the harness can observe temperature, and the absence for claude-opus-4-8 is a
#           real strip performed somewhere in the pipeline.
# If NO  -> the harness cannot observe agent temperature, so the live-request proof is
#           incapable of demonstrating this fix and must not be used as evidence.
#
# usage: diag-temp-forwarding.sh <model-id>
set -euo pipefail

MODEL_ID="${1:?usage: diag-temp-forwarding.sh <model-id>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"

SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6338-fwd-XXXXXX")"
MOCK_PID=""
cleanup() { [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true; rm -rf "$SBX"; }
trap cleanup EXIT

PROJECT="$SBX/project"
mkdir -p "$PROJECT/.opencode" "$SBX/home" "$SBX/tmp"
REQ_LOG="$SBX/requests.json"

export HOME="$SBX/home" USERPROFILE="$SBX/home"
export APPDATA="$SBX/home/AppData/Roaming" LOCALAPPDATA="$SBX/home/AppData/Local"
export XDG_DATA_HOME="$SBX/home/.local/share" XDG_CONFIG_HOME="$SBX/home/.config"
export XDG_STATE_HOME="$SBX/home/.local/state" XDG_CACHE_HOME="$SBX/home/.cache"
export TMPDIR="$SBX/tmp" TEMP="$SBX/tmp" TMP="$SBX/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
mkdir -p "$APPDATA" "$LOCALAPPDATA" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

node "$HERE/mock-provider.mjs" "$REQ_LOG" > "$SBX/mock.log" 2>&1 &
MOCK_PID=$!
PORT=""
for _ in $(seq 1 50); do
  PORT="$(sed -n 's/^MOCK_PORT=//p' "$SBX/mock.log" | head -1)"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || { echo "FATAL: no mock port" >&2; exit 1; }

cat > "$PROJECT/.opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO_WIN/dist/index.js"],
  "provider": {
    "azure-anthropic": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Azure Anthropic",
      "options": { "baseURL": "http://127.0.0.1:$PORT/v1", "apiKey": "mock-key" },
      "models": { "$MODEL_ID": { "name": "$MODEL_ID" } }
    }
  }
}
JSON

cat > "$PROJECT/.opencode/oh-my-openagent.jsonc" <<JSON
{
  "agents": {
    "sisyphus": { "model": "azure-anthropic/$MODEL_ID", "temperature": 0.1 }
  }
}
JSON

echo "### model under test: azure-anthropic/$MODEL_ID (agent temperature 0.1)"
( cd "$PROJECT" && timeout 300s opencode run "ping" ) >/dev/null 2>&1 || true

node -e '
const { readFileSync, existsSync } = require("node:fs");
const p = process.argv[1];
if (!existsSync(p)) { console.log("NO_REQUEST_CAPTURED=true"); process.exit(0); }
const entries = JSON.parse(readFileSync(p, "utf-8"));
const chat = entries.filter((e) => Array.isArray(e.body?.messages));
console.log("chat_requests=" + chat.length);
for (const e of chat) {
  console.log("  model=" + e.body.model + " temperature=" + JSON.stringify(e.body.temperature) +
    " body_keys=" + Object.keys(e.body).filter((k) => k !== "messages").sort().join(","));
}
console.log("TEMPERATURE_IN_REQUEST=" + chat.some((e) => e.body.temperature !== undefined));
' "$REQ_LOG"
