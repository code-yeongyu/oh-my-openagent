#!/usr/bin/env bash
set -euo pipefail

OUT="${1:?usage: review-rerun-driver.sh <output-file>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6338-review-XXXXXX")"
trap 'rm -rf "$SBX"' EXIT

PROJECT="$SBX/project"
mkdir -p "$PROJECT/.opencode" "$SBX/home" "$SBX/tmp"

cat > "$PROJECT/.opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO_WIN/dist/index.js"]
}
JSON

cat > "$PROJECT/.opencode/oh-my-openagent.jsonc" <<'JSON'
{
  "agent_order": ["oracle", "sisyphus"],
  "agents": {
    "oracle": {
      "model": "custom-provider/future-model",
      "temperature": 0.1
    },
    "sisyphus": {
      "model": "openai/gpt-5.4"
    }
  }
}
JSON

export HOME="$SBX/home"
export USERPROFILE="$SBX/home"
export APPDATA="$SBX/home/AppData/Roaming"
export LOCALAPPDATA="$SBX/home/AppData/Local"
export XDG_DATA_HOME="$SBX/home/.local/share"
export XDG_CONFIG_HOME="$SBX/home/.config"
export XDG_STATE_HOME="$SBX/home/.local/state"
export XDG_CACHE_HOME="$SBX/home/.cache"
export TMPDIR="$SBX/tmp"
export TEMP="$SBX/tmp"
export TMP="$SBX/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
mkdir -p "$APPDATA" "$LOCALAPPDATA" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"
mkdir -p "$XDG_CACHE_HOME/oh-my-opencode"
cat > "$XDG_CACHE_HOME/oh-my-opencode/provider-models.json" <<'JSON'
{
  "models": {
    "custom-provider": [
      {
        "id": "future-model",
        "temperature": false
      }
    ]
  },
  "connected": ["custom-provider"],
  "updatedAt": "2026-07-31T00:00:00.000Z"
}
JSON

{
  echo "### PR #6485 review rerun"
  echo "### surface: real opencode debug config"
  echo "### opencode: $(opencode --version 2>&1 | head -1)"
  echo "### repo: $REPO_WIN"
  echo "=== \$ bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod ==="
} > "$OUT"

( cd "$REPO" && timeout 240s bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod ) >> "$OUT" 2>&1
echo "EXIT=0" >> "$OUT"

echo "=== \$ opencode debug paths ===" >> "$OUT"
( cd "$PROJECT" && opencode debug paths ) >> "$OUT" 2>&1
echo "EXIT=0" >> "$OUT"

echo "=== \$ opencode debug config ===" >> "$OUT"
( cd "$PROJECT" && timeout 240s opencode debug config ) > "$SBX/config.json" 2>"$SBX/config.err"
echo "EXIT=0" >> "$OUT"

node -e '
const { readFileSync } = require("node:fs");
const raw = readFileSync(process.argv[1], "utf-8");
let config;
try {
  config = JSON.parse(raw);
} catch {
  const start = raw.indexOf("{");
  config = start >= 0 ? JSON.parse(raw.slice(start)) : null;
}
if (!config) {
  console.error("UNPARSEABLE debug config output");
  process.exit(1);
}
const agents = config.agent ?? {};
const names = Object.keys(agents);
const oracleKey = names.find((name) => /^oracle/i.test(name));
const sisyphusKey = names.find((name) => /^sisyphus/i.test(name));
const oracle = oracleKey ? agents[oracleKey] : undefined;
const oracleIndex = oracleKey ? names.indexOf(oracleKey) : -1;
const sisyphusIndex = sisyphusKey ? names.indexOf(sisyphusKey) : -1;
const temperatureRemoved = oracle !== undefined && oracle.temperature === undefined;
const configuredOrderPreserved =
  oracleIndex >= 0 && sisyphusIndex >= 0 && oracleIndex < sisyphusIndex;
console.log("agent_names=" + names.join(", "));
console.log("oracle_model=" + (oracle?.model ?? "(missing)"));
console.log("oracle_temperature_present=" + (oracle?.temperature !== undefined));
console.log("configured_order_preserved=" + configuredOrderPreserved);
if (!temperatureRemoved || !configuredOrderPreserved) process.exit(1);
' "$SBX/config.json" >> "$OUT" 2>&1

{
  echo "--- stderr from debug config (truncated) ---"
  head -c 1200 "$SBX/config.err"
} >> "$OUT"

echo "wrote $OUT"
