#!/usr/bin/env bash
# Diagnostic: does `agents.<name>.temperature` from the omo config actually land in the
# resolved opencode agent config, and which agent does `opencode run` actually execute?
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"

SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6338-diag-XXXXXX")"
trap 'rm -rf "$SBX"' EXIT
PROJECT="$SBX/project"
mkdir -p "$PROJECT/.opencode" "$SBX/home" "$SBX/tmp"

export HOME="$SBX/home" USERPROFILE="$SBX/home"
export APPDATA="$SBX/home/AppData/Roaming" LOCALAPPDATA="$SBX/home/AppData/Local"
export XDG_DATA_HOME="$SBX/home/.local/share" XDG_CONFIG_HOME="$SBX/home/.config"
export XDG_STATE_HOME="$SBX/home/.local/state" XDG_CACHE_HOME="$SBX/home/.cache"
export TMPDIR="$SBX/tmp" TEMP="$SBX/tmp" TMP="$SBX/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
mkdir -p "$APPDATA" "$LOCALAPPDATA" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

cat > "$PROJECT/.opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO_WIN/dist/index.js"],
  "provider": {
    "azure-anthropic": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Azure Anthropic",
      "options": { "baseURL": "http://127.0.0.1:9/v1", "apiKey": "mock-key" },
      "models": { "claude-opus-4-8": { "name": "Claude Opus 4.8" } }
    }
  }
}
JSON

cat > "$PROJECT/.opencode/oh-my-openagent.jsonc" <<'JSON'
{
  "agents": {
    "oracle": { "model": "azure-anthropic/claude-opus-4-8", "temperature": 0.1 },
    "sisyphus": { "model": "azure-anthropic/claude-opus-4-8", "temperature": 0.1 }
  }
}
JSON

cd "$PROJECT"
timeout 240s opencode debug config > "$SBX/config.json" 2>"$SBX/config.err" || true

node -e '
const { readFileSync } = require("node:fs");
const raw = readFileSync(process.argv[1], "utf-8");
let cfg;
try { cfg = JSON.parse(raw); } catch {
  const i = raw.indexOf("{");
  cfg = i >= 0 ? JSON.parse(raw.slice(i)) : null;
}
if (!cfg) { console.log("UNPARSEABLE"); process.exit(0); }
const agents = cfg.agent ?? {};
for (const [name, a] of Object.entries(agents)) {
  console.log(
    JSON.stringify(name) +
      " mode=" + a.mode +
      " model=" + a.model +
      " temperature=" + JSON.stringify(a.temperature) +
      " topP=" + JSON.stringify(a.topP ?? a.top_p),
  );
}
console.log("root_model=" + cfg.model);
' "$SBX/config.json"

echo "--- stderr (head) ---"
head -c 600 "$SBX/config.err" || true
