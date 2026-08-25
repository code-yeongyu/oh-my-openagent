#!/bin/bash
# Real-surface QA for the canonical omo agent directory.
# Drives the CHANGED launcher in an isolated HOME: once against the REAL pinned engine, once
# against a capture stub that records exactly what the engine is handed.
set -u
WT="$1"
REAL_OMO="$HOME/.bun/install/global/node_modules/omo-ai"
REAL_STATE="$HOME/.omo/agent/settings.json"
SANDBOX=$(mktemp -d /tmp/omo-agentdir-qa.XXXXXX)
SHOME="$SANDBOX/home"
PKG="$SANDBOX/pkg/omo-ai"
STUBPKG="$SANDBOX/stub/omo-ai"

mkdir -p "$SHOME" "$PKG/node_modules/@code-yeongyu" "$STUBPKG/node_modules/@code-yeongyu/senpi/dist"
cp -R "$WT/packages/omo-native/bin" "$PKG/bin"
cp "$WT/packages/omo-native/package.json" "$PKG/package.json"
ln -s "$REAL_OMO/node_modules/@code-yeongyu/senpi" "$PKG/node_modules/@code-yeongyu/senpi"
ln -s "$REAL_OMO/plugin" "$PKG/plugin"

cp -R "$WT/packages/omo-native/bin" "$STUBPKG/bin"
cp "$WT/packages/omo-native/package.json" "$STUBPKG/package.json"
cat > "$STUBPKG/node_modules/@code-yeongyu/senpi/package.json" <<'JSON'
{ "name": "@code-yeongyu/senpi", "version": "2026.8.12-4", "type": "module", "exports": { ".": "./dist/index.js" } }
JSON
echo 'export const stub = true' > "$STUBPKG/node_modules/@code-yeongyu/senpi/dist/index.js"
cat > "$STUBPKG/node_modules/@code-yeongyu/senpi/dist/cli.js" <<'JSON'
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify(process.env, null, 2))
JSON

run() {
  env -u OMO_CODING_AGENT_DIR -u SENPI_CODING_AGENT_DIR -u PI_CODING_AGENT_DIR \
    HOME="$SHOME" node "$PKG/bin/omo.js" "$@" < /dev/null &
  local pid=$!
  ( sleep 60; kill -9 $pid 2>/dev/null ) & local watch=$!
  wait $pid; local rc=$?
  kill $watch 2>/dev/null
  return $rc
}

echo "== isolation: developer state BEFORE"
shasum "$REAL_STATE" "$HOME/.omo/settings.json"

echo
echo "== sandbox HOME: ONLY the pre-unification flat layout holds state"
mkdir -p "$SHOME/.omo"
cat > "$SHOME/.omo/settings.json" <<'JSON'
{
  "favoriteModels": ["anthropic/claude-fable-5", "apitopia/kimi-k3-unlocked"],
  "retry": {
    "modelFallback": true,
    "fallbackChains": {
      "claude-fable-5": [],
      "openmodel/claude-fable-5": ["anthropic-api/claude-fable-5:xhigh"]
    }
  }
}
JSON
FLAT_BEFORE=$(shasum "$SHOME/.omo/settings.json" | cut -d' ' -f1)
find "$SHOME" -type f | sed "s|$SHOME|<HOME>|"

echo
echo "== 1. omo --version : the changed launcher boots against the real pinned engine"
run --version

echo
echo "== 2. omo doctor : first launch adopts the stranded flat state"
run doctor 2>&1 | rg 'carried forward|senpi version|WARN duplicate' || true

echo
echo "== canonical file after one launch"
cat "$SHOME/.omo/agent/settings.json"
echo "-- keys readable at the canonical location:"
node -e 'const s=require(process.argv[1]);console.log(JSON.stringify({favoriteModels:s.favoriteModels,fallbackChains:s.retry?.fallbackChains}))' "$SHOME/.omo/agent/settings.json"
echo "-- legacy flat file:"
if [ "$FLAT_BEFORE" = "$(shasum "$SHOME/.omo/settings.json" | cut -d' ' -f1)" ]; then echo "UNCHANGED $FLAT_BEFORE"; else echo "MUTATED - FAIL"; fi

echo
echo "== 3. second launch is idempotent"
CANON_BEFORE=$(shasum "$SHOME/.omo/agent/settings.json" | cut -d' ' -f1)
if run doctor 2>&1 | rg -q 'carried forward'; then echo "FAIL: adopted twice"; else echo "PASS: no adoption notice on the second launch"; fi
if [ "$CANON_BEFORE" = "$(shasum "$SHOME/.omo/agent/settings.json" | cut -d' ' -f1)" ]; then echo "PASS: canonical file unchanged"; else echo "FAIL: canonical rewritten"; fi

echo
echo "== 4. omo setup --dry-run resolves the canonical directory"
mkdir -p "$SHOME/.local/share/opencode"
printf '{"anthropic":{"type":"api","key":"SANDBOX-ONLY-NOT-A-REAL-KEY"}}' > "$SHOME/.local/share/opencode/auth.json"
run setup --dry-run 2>&1 | rg 'senpi:|planned-add|DRY RUN' || true
if [ -d "$SHOME/.senpi" ]; then echo "FAIL: the legacy engine directory was created"; else echo "PASS: no ~/.senpi anywhere in the sandbox"; fi

echo
echo "== 5. what the launcher actually hands the engine (capture stub)"
CAPTURE="$SANDBOX/child-env.json"
env -u OMO_CODING_AGENT_DIR -u SENPI_CODING_AGENT_DIR -u PI_CODING_AGENT_DIR \
  HOME="$SHOME" CAPTURE_FILE="$CAPTURE" node "$STUBPKG/bin/omo.js" say hi < /dev/null
node -e '
const env = require(process.argv[1])
const brand = JSON.parse(env.SENPI_BRAND ?? "{}")
console.log(JSON.stringify({
  OMO_CODING_AGENT_DIR: env.OMO_CODING_AGENT_DIR,
  SENPI_CODING_AGENT_DIR: env.SENPI_CODING_AGENT_DIR,
  brandConfigDir: brand.configDir,
  brandFlatLayout: brand.flatLayout,
}, null, 2))' "$CAPTURE" | sed "s|$SHOME|<HOME>|g"

echo
echo "== 6. an explicit override still wins"
env -u SENPI_CODING_AGENT_DIR -u PI_CODING_AGENT_DIR \
  OMO_CODING_AGENT_DIR="$SANDBOX/pinned" HOME="$SHOME" CAPTURE_FILE="$CAPTURE" \
  node "$STUBPKG/bin/omo.js" say hi < /dev/null
node -e 'const e=require(process.argv[1]);console.log(JSON.stringify({OMO_CODING_AGENT_DIR:e.OMO_CODING_AGENT_DIR,SENPI_CODING_AGENT_DIR:e.SENPI_CODING_AGENT_DIR}))' "$CAPTURE" | sed "s|$SANDBOX|<SANDBOX>|g"

echo
echo "== isolation: developer state AFTER"
shasum "$REAL_STATE" "$HOME/.omo/settings.json"

echo
echo "== cleanup"
rm -rf "$SANDBOX" /tmp/omo-agentdir-qa.8vm9LK
if [ -d "$SANDBOX" ]; then echo "FAIL: sandbox survived"; else echo "removed $SANDBOX"; fi
ls -d /tmp/omo-agentdir-qa.* 2>/dev/null || echo "no QA sandboxes remain"
