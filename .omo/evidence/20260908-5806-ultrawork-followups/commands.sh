#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
EVIDENCE="$ROOT/.omo/evidence/20260908-5806-ultrawork-followups"
BUN="${BUN:-bun}"
DB="$(opencode db path)"
test -f "$DB"
printf 'BUN_VERSION=%s\n' "$("$BUN" --version)"
before="$(sqlite3 "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_SESSIONS_BEFORE=%s\n' "$before"
"$BUN" "$EVIDENCE/build.ts"
docker run --rm --name "omo-qa-5806-$$" --user root --entrypoint node \
  --mount "type=bind,src=$EVIDENCE,dst=/evidence" \
  omo-qa:latest /evidence/run.mjs
after="$(sqlite3 "$DB" 'SELECT count(*) FROM session')"
printf 'HOST_DB_SESSIONS_AFTER=%s\n' "$after"
test "$before" = "$after"
printf 'HOST_DB_UNCHANGED\n'
