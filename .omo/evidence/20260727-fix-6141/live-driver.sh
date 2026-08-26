#!/usr/bin/env bash
# Live-surface driver for issue #6141.
#
# Drives REAL opencode (`opencode debug config`) against a fully isolated sandbox
# and reports whether the Hephaestus agent survives agent registration when its
# configured model is an AWS Bedrock vendor-prefixed GPT-5 id.
#
# Isolation: HOME / USERPROFILE / APPDATA / LOCALAPPDATA / XDG_* and process
# temp variables are all redirected into a mktemp sandbox that is deleted on exit,
# so the real ~/.local/share/opencode database, temp directory, and the real user
# config are never read or written.
#
# Run once on unmodified upstream/dev and once with the fix applied, then diff.
#
# usage: bash live-driver.sh <output-file> <expect-registered:true|false>
set -euo pipefail

OUT="${1:?usage: live-driver.sh <output-file> <expect-registered:true|false>}"
EXPECT_REGISTERED="${2:?usage: live-driver.sh <output-file> <expect-registered:true|false>}"
if [[ "$EXPECT_REGISTERED" != "true" && "$EXPECT_REGISTERED" != "false" ]]; then
  echo "expect-registered must be true or false" >&2
  exit 2
fi
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO_WIN="$(cd "$REPO" && pwd -W 2>/dev/null || echo "$REPO")"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6141-XXXXXX")"
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
  "agents": {
    "hephaestus": {
      "model": "amazon-bedrock/openai.gpt-5.4"
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

{
  echo "### live-surface capture for issue #6141"
  echo "### surface: REAL opencode -> opencode debug config (agent registration map)"
  echo "### opencode: $(opencode --version 2>&1 | head -1)"
  echo "### repo: $REPO_WIN"
  echo "=== \$ bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod ==="
} > "$OUT"

( cd "$REPO" && bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod ) >> "$OUT" 2>&1

{
  echo "EXIT=0"
  echo "### agent.ts diff vs upstream/dev at capture time:"
  git -C "$REPO" diff --stat upstream/dev -- packages/omo-opencode/src/agents/hephaestus/agent.ts
  echo "### (empty above == unmodified base; non-empty == fix applied)"
  echo
  echo "--- sandbox project config ---"
  cat "$PROJECT/.opencode/oh-my-openagent.jsonc"
  echo
  echo "=== \$ opencode debug paths   (must all be inside the sandbox) ==="
} >> "$OUT"

( cd "$PROJECT" && opencode debug paths ) >> "$OUT" 2>&1
echo "EXIT=$?" >> "$OUT"

echo "" >> "$OUT"
echo "=== \$ opencode debug config  -> resolved agent map ===" >> "$OUT"
( cd "$PROJECT" && opencode debug config ) > "$SBX/config.json" 2>"$SBX/config.err"
echo "EXIT=$?" >> "$OUT"

node -e '
const { readFileSync } = require("node:fs");
const raw = readFileSync(process.argv[1], "utf-8");
let cfg;
try { cfg = JSON.parse(raw) } catch (e) {
  const s = raw.indexOf("{");
  cfg = s >= 0 ? JSON.parse(raw.slice(s)) : null;
}
if (!cfg) { console.error("  UNPARSEABLE debug config output"); process.exit(1) }
const agents = cfg.agent ?? {};
const names = Object.keys(agents).sort();
console.log("  registered agent count : " + names.length);
console.log("  agent names            : " + names.join(", "));
console.log("");
// opencode keys the resolved agent map by DISPLAY name, so match case-insensitively.
const key = names.find((n) => /^hephaestus/i.test(n));
const h = key ? agents[key] : undefined;
const registered = h !== undefined;
const expected = process.argv[2] === "true";
console.log("  >>> HEPHAESTUS REGISTERED : " + registered + (key ? "  (key: " + key + ")" : ""));
if (h) {
  console.log("      hephaestus.model    : " + (h.model ?? "(unset)"));
  console.log("      hephaestus.mode     : " + (h.mode ?? "(unset)"));
  console.log("      hephaestus.hidden   : " + (h.hidden ?? "(unset)"));
}
if (registered !== expected) {
  console.error("  EXPECTATION FAILED: expected HEPHAESTUS REGISTERED = " + expected);
  process.exit(1);
}
const controlKey = names.find((n) => /^sisyphus/i.test(n)) ?? names.find((n) => /^oracle/i.test(n));
console.log("  control agent registered  : " + (controlKey !== undefined) + (controlKey ? "  (key: " + controlKey + ")" : ""));
' "$SBX/config.json" "$EXPECT_REGISTERED" >> "$OUT" 2>&1

{
  echo ""
  echo "--- stderr from debug config (truncated) ---"
  head -c 1200 "$SBX/config.err"
} >> "$OUT"

echo "wrote $OUT"
