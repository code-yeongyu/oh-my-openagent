#!/usr/bin/env bash
set -euo pipefail
EVIDENCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$EVIDENCE/../../.." && pwd)"
cd "$ROOT"
test "$(bun --version)" = "1.4.0"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6445.XXXXXX")"
CONTAINER="omo-6445-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT
mkdir -p "$SANDBOX"/{home/.config/opencode,data,cache,state,project,tmp,tool-home}
cp "$EVIDENCE/legacy-input.json" "$SANDBOX/home/.config/opencode/oh-my-openagent.json"
(
  cd "$SANDBOX/project"
  env -i PATH="$PATH" HOME="$SANDBOX/home" \
    XDG_CONFIG_HOME="$SANDBOX/home/.config" XDG_DATA_HOME="$SANDBOX/data" \
    XDG_CACHE_HOME="$SANDBOX/cache" XDG_STATE_HOME="$SANDBOX/state" \
    TMPDIR="$SANDBOX/tmp" OMO_DISABLE_POSTHOG=1 OMO_SEND_ANONYMOUS_TELEMETRY=0 \
    node "$ROOT/dist/cli-node/index.js" config migrate --json
)
node -e 'const fs=require("node:fs"); const {parse}=require("jsonc-parser"); const errors=[]; const value=parse(fs.readFileSync(process.argv[1],"utf8"),errors); if(errors.length) throw new Error("Invalid migrated JSONC"); fs.writeFileSync(process.argv[2],JSON.stringify(value));' \
  "$SANDBOX/home/.omo/omo.jsonc" "$SANDBOX/migrated.json"
validate() {
  env -i PATH="$PATH" HOME="$SANDBOX/tool-home" BUN_INSTALL_CACHE_DIR="$SANDBOX/tool-cache" \
    bun x --package ajv-cli@5.0.0 ajv validate --strict=false --all-errors -s "$1" -d "$2"
}
validate "$ROOT/assets/omo.schema.json" "$SANDBOX/migrated.json"
for data in "$EVIDENCE"/valid-unified-*.json; do
  validate "$ROOT/assets/omo.schema.json" "$data"
done
validate "$ROOT/assets/oh-my-opencode.schema.json" "$EVIDENCE/valid-flat.json"
for data in "$EVIDENCE"/invalid-*.json; do
  status=0
  validate "$ROOT/assets/omo.schema.json" "$data" || status=$?
  test "$status" -eq 1
done
DB="$(opencode db path)"
before="$(sqlite3 "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_BEFORE=%s\n' "$before"
docker run --rm --name "$CONTAINER" --tmpfs /qa:rw,exec \
  --mount "type=bind,src=$ROOT,dst=/source,readonly" \
  --mount "type=bind,src=$EVIDENCE,dst=/evidence" \
  --entrypoint node omo-qa:latest /evidence/server-smoke.mjs
after="$(sqlite3 "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_AFTER=%s\n' "$after"
test "$before" = "$after"
if docker inspect "$CONTAINER" >/dev/null 2>&1; then exit 1; fi
cleanup
trap - EXIT
test ! -e "$SANDBOX"
printf 'SCHEMA_QA_PASS_HOST_DB_UNCHANGED_RESOURCES_REMOVED\n'
