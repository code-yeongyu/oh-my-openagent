#!/usr/bin/env bash
# Live proof for #6338 / PR #6485.
#
# Drives the REAL `opencode run` process with the omo plugin loaded, pointed at a local
# mock model endpoint that records the request body. Asserts whether the outgoing request
# still carries `temperature` for a Claude Opus 4.8 family model served by an unrecognized
# custom provider -- the exact symptom reported in issue #6338.
#
# usage: live-request-driver.sh <output-file> <label>
set -euo pipefail

OUT="${1:?usage: live-request-driver.sh <output-file> <label>}"
LABEL="${2:?usage: live-request-driver.sh <output-file> <label>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"

SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6338-live-XXXXXX")"
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$SBX"
}
trap cleanup EXIT

PROJECT="$SBX/project"
mkdir -p "$PROJECT/.opencode" "$SBX/home" "$SBX/tmp"

REQ_LOG="$SBX/requests.json"

# --- isolated environment: never touch the real opencode state -------------
export HOME="$SBX/home"
export USERPROFILE="$SBX/home"
export APPDATA="$SBX/home/AppData/Roaming"
export LOCALAPPDATA="$SBX/home/AppData/Local"
export XDG_DATA_HOME="$SBX/home/.local/share"
export XDG_CONFIG_HOME="$SBX/home/.config"
export XDG_STATE_HOME="$SBX/home/.local/state"
export XDG_CACHE_HOME="$SBX/home/.cache"
export TMPDIR="$SBX/tmp" TEMP="$SBX/tmp" TMP="$SBX/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
mkdir -p "$APPDATA" "$LOCALAPPDATA" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

# --- start the mock model endpoint ----------------------------------------
node "$HERE/mock-provider.mjs" "$REQ_LOG" > "$SBX/mock.log" 2>&1 &
MOCK_PID=$!
PORT=""
for _ in $(seq 1 50); do
  PORT="$(sed -n 's/^MOCK_PORT=//p' "$SBX/mock.log" | head -1)"
  [ -n "$PORT" ] && break
  sleep 0.2
done
if [ -z "$PORT" ]; then
  echo "FATAL: mock provider never reported a port" >&2
  cat "$SBX/mock.log" >&2
  exit 1
fi

# --- project config: plugin + a custom provider that is NOT in any capability cache
cat > "$PROJECT/.opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO_WIN/dist/index.js"],
  "provider": {
    "azure-anthropic": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Azure Anthropic",
      "options": {
        "baseURL": "http://127.0.0.1:$PORT/v1",
        "apiKey": "mock-key"
      },
      "models": {
        "claude-opus-4-8": { "name": "Claude Opus 4.8" }
      }
    }
  }
}
JSON

# The reporter's setup: an agent pinned to the custom-provider Opus 4.8 model WITH a temperature.
# `oracle` is a subagent, so `opencode run` falls back to the default primary agent; the
# temperature is set on both so the executing agent really does carry it. Without this the
# assertion would be vacuous (no temperature set == nothing to strip).
cat > "$PROJECT/.opencode/oh-my-openagent.jsonc" <<'JSON'
{
  "agents": {
    "oracle": {
      "model": "azure-anthropic/claude-opus-4-8",
      "temperature": 0.1
    },
    "sisyphus": {
      "model": "azure-anthropic/claude-opus-4-8",
      "temperature": 0.1
    }
  }
}
JSON

{
  echo "### PR #6485 live request proof"
  echo "### label: $LABEL"
  echo "### surface: real \`opencode run\` -> local mock model endpoint (records request body)"
  echo "### opencode: $(opencode --version 2>&1 | head -1)"
  echo "### node: $(node --version 2>&1)"
  echo "### repo: $REPO_WIN"
  echo "### mock endpoint: http://127.0.0.1:$PORT/v1"
  echo "### agent config: azure-anthropic/claude-opus-4-8 with temperature 0.1"
  echo
  echo "=== \$ git -C repo diff --stat upstream/dev -- packages/model-core (product under test) ==="
  ( cd "$REPO" && git diff --stat upstream/dev -- packages/model-core/src/model-settings-compatibility.ts packages/model-core/src/model-capability-heuristics.ts ) 2>&1
  echo
  echo "=== \$ bun build packages/omo-opencode/src/index.ts --outdir dist ==="
} > "$OUT"

( cd "$REPO" && bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod ) >> "$OUT" 2>&1
echo "build EXIT=$?" >> "$OUT"

echo >> "$OUT"
echo "=== \$ opencode run 'ping' (default primary agent already pinned to the model) ===" >> "$OUT"
( cd "$PROJECT" && timeout 300s opencode run "ping" ) >> "$OUT" 2>&1 || echo "(opencode exited non-zero; request capture below is what matters)" >> "$OUT"

echo >> "$OUT"
echo "=== recorded outgoing request body ===" >> "$OUT"
node -e '
const { readFileSync, existsSync } = require("node:fs");
const path = process.argv[1];
if (!existsSync(path)) {
  console.log("NO_REQUEST_CAPTURED=true");
  process.exit(0);
}
const entries = JSON.parse(readFileSync(path, "utf-8"));
const chat = entries.filter((e) => typeof e.body === "object" && Array.isArray(e.body?.messages));
console.log("requests_captured=" + entries.length + " chat_requests=" + chat.length);
for (const entry of chat) {
  const body = entry.body;
  const keys = Object.keys(body).filter((k) => k !== "messages").sort();
  console.log("  url=" + entry.url);
  console.log("  model=" + body.model);
  console.log("  body_keys=" + keys.join(","));
  console.log("  temperature=" + JSON.stringify(body.temperature));
  console.log("  top_p=" + JSON.stringify(body.top_p));
}
const withTemp = chat.filter((e) => e.body.temperature !== undefined);
console.log("TEMPERATURE_IN_REQUEST=" + (withTemp.length > 0));
' "$REQ_LOG" >> "$OUT" 2>&1

echo >> "$OUT"
echo "=== isolation proof: real opencode DB untouched ===" >> "$OUT"
{
  echo "sandbox HOME=$HOME"
  echo "sandbox db exists=$([ -f "$XDG_DATA_HOME/opencode/opencode.db" ] && echo yes || echo no)"
} >> "$OUT"

echo "wrote $OUT"
