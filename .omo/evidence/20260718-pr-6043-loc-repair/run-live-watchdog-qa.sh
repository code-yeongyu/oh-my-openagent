#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE="$ROOT/.omo/evidence/20260718-pr-6043-loc-repair"
BASE_SCRIPT="$ROOT/.omo/evidence/20260718-pr-6043-overlap-ownership-repair/run-live-watchdog-qa.sh"
TMP_SCRIPT="$(mktemp -t pr6043-loc-repair-live.XXXXXX)"
SOURCE_PATHS=(
  packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-dispatch.ts
  packages/omo-opencode/src/hooks/runtime-fallback/reserved-retry-dispatch.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-state.ts
)

trap 'rm -f "$TMP_SCRIPT"' EXIT
cd "$ROOT"
test -z "$(git status --porcelain=v1)"
COMMIT_HEAD="$(git rev-parse HEAD)"
SOURCE_FILES_SHA256_BEFORE="$(shasum -a 256 "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"

sed -e "s#EVIDENCE=\"/tmp/pr6043-overlap-live-evidence\"#EVIDENCE=\"$EVIDENCE\"#" \
  "$BASE_SCRIPT" > "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"
printf 'commit_head=%s\nsource_files_sha256_before=%s\n' \
  "$COMMIT_HEAD" "$SOURCE_FILES_SHA256_BEFORE" > "$EVIDENCE/live-committed-source.txt"
printf '%s\n' "${SOURCE_PATHS[@]}" >> "$EVIDENCE/live-committed-source.txt"

bash "$TMP_SCRIPT" | tee "$EVIDENCE/live-watchdog-qa.txt"

SOURCE_FILES_SHA256_AFTER="$(shasum -a 256 "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"
test "$SOURCE_FILES_SHA256_BEFORE" = "$SOURCE_FILES_SHA256_AFTER"
test -z "$(git diff --no-ext-diff "$COMMIT_HEAD" -- "${SOURCE_PATHS[@]}")"
printf 'source_files_sha256_after=%s\nsource_unchanged_during_qa=yes\n' \
  "$SOURCE_FILES_SHA256_AFTER" >> "$EVIDENCE/live-committed-source.txt"
