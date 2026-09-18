#!/usr/bin/env bash
set -euo pipefail
: "${BUN_BIN:?Set BUN_BIN to the audited Bun 1.4.0 executable}"
: "${NODE_BIN:?Set NODE_BIN to the audited Node 24 executable}"
export PATH="$(dirname "$BUN_BIN"):$(dirname "$NODE_BIN"):$PATH"
test "$(bun --version)" = 1.4.0
[[ "$(node --version)" == v24.* ]]
EVIDENCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE/../../.." && pwd)"
FIXTURES="$ROOT/.omo/evidence/20260909-6445-input-schema"
cd "$ROOT"
SANDBOX="$(mktemp -d)"
CONTAINER="omo-pr7818-refresh-$$"
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT
mkdir -p "$SANDBOX"/{home/.config/opencode,data,cache,state,project,tmp,tool-home}
cp "$FIXTURES/legacy-input.json" "$SANDBOX/home/.config/opencode/oh-my-openagent.json"
(
 cd "$SANDBOX/project"
 env -i PATH="$PATH" HOME="$SANDBOX/home" XDG_CONFIG_HOME="$SANDBOX/home/.config" \
 XDG_DATA_HOME="$SANDBOX/data" XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state" \
 TMPDIR="$SANDBOX/tmp" OMO_DISABLE_POSTHOG=1 OMO_SEND_ANONYMOUS_TELEMETRY=0 \
 node "$ROOT/dist/cli-node/index.js" config migrate --json
)
node -e 'const fs=require("node:fs"); const {parse}=require("jsonc-parser"); const errors=[]; const value=parse(fs.readFileSync(process.argv[1],"utf8"),errors); if(errors.length) throw new Error("Invalid migrated JSONC"); fs.writeFileSync(process.argv[2],JSON.stringify(value));' "$SANDBOX/home/.omo/omo.jsonc" "$SANDBOX/migrated.json"
validate() {
 env -i PATH="$PATH" HOME="$SANDBOX/tool-home" BUN_INSTALL_CACHE_DIR="$SANDBOX/tool-cache" \
 bun x --package ajv-cli@5.0.0 ajv validate --strict=false --all-errors -s "$1" -d "$2"
}
validate assets/omo.schema.json "$SANDBOX/migrated.json"
for data in "$FIXTURES"/valid-unified-*.json; do validate assets/omo.schema.json "$data"; done
validate assets/oh-my-opencode.schema.json "$FIXTURES/valid-flat.json"
for data in "$FIXTURES"/invalid-*.json; do
 status=0; validate assets/omo.schema.json "$data" || status=$?
 test "$status" -eq 1
done
DB="${HOST_OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
before="$(sqlite3 -readonly "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_BEFORE=%s\n' "$before"
cp "$FIXTURES/server-smoke.mjs" "$SANDBOX/server-smoke.mjs"
cp "$FIXTURES/valid-unified-migrated.json" "$SANDBOX/valid-unified-migrated.json"
docker run --rm --name "$CONTAINER" --tmpfs /qa:rw,exec \
 --mount "type=bind,src=$ROOT,dst=/source,readonly" \
 --mount "type=bind,src=$SANDBOX,dst=/evidence" \
 --entrypoint node omo-qa:latest /evidence/server-smoke.mjs
cp "$SANDBOX/server-smoke.json" "$EVIDENCE/server-smoke.json"
after="$(sqlite3 -readonly "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_AFTER=%s\n' "$after"
test "$before" = "$after"
if docker inspect "$CONTAINER" >/dev/null 2>&1; then exit 1; fi
cleanup
trap - EXIT
test ! -e "$SANDBOX"
printf 'SCHEMA_QA_PASS_HOST_DB_UNCHANGED_RESOURCES_REMOVED\n'
