#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
EVIDENCE="$ROOT/.omo/evidence/20260908-6077-deferred-git-bash"
BUN="${BUN:-bun}"
config_hash() {
  if [ -f "$HOME/.codex/config.toml" ]; then
    local value
    value="$(shasum -a 256 "$HOME/.codex/config.toml")"
    printf '%s' "${value%% *}"
  else
    printf 'ABSENT'
  fi
}
before="$(config_hash)"
printf 'HOST_CODEX_CONFIG_SHA256_BEFORE=%s\n' "$before"
"$BUN" run --cwd packages/omo-codex/plugin/components/git-bash build
"$BUN" build "$EVIDENCE/mcp-fixture.ts" --outfile "$EVIDENCE/mcp-fixture.mjs" --target node
node --check "$EVIDENCE/qa.mjs"
docker run --rm --name "omo-qa-6077-$$" --network none --tmpfs /qa:rw,exec \
  --mount "type=bind,src=$ROOT/packages/omo-codex/plugin/components/git-bash,dst=/component,readonly" \
  --mount "type=bind,src=$EVIDENCE,dst=/task" \
  --entrypoint node omo-qa:latest /task/qa.mjs
after="$(config_hash)"
printf 'HOST_CODEX_CONFIG_SHA256_AFTER=%s\n' "$after"
test "$before" = "$after"
printf 'HOST_CODEX_CONFIG_UNCHANGED\n'
