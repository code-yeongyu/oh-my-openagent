#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EVIDENCE="$ROOT/.omo/evidence/20260718-pr-6043-generation-token-repair"
BASE_SCRIPT="$ROOT/.omo/evidence/20260718-pr-6043-overlap-ownership-repair/run-live-watchdog-qa.sh"
TMP_SCRIPT="$(mktemp -t pr6043-generation-live.XXXXXX)"
SOURCE_PATHS=(
  packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-dispatch.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-fire.ts
  packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts
  packages/omo-opencode/src/hooks/runtime-fallback/hook.ts
  packages/omo-opencode/src/hooks/runtime-fallback/types.ts
  packages/omo-opencode/src/hooks/runtime-fallback/watchdog-abort-provenance.ts
)

trap 'rm -f "$TMP_SCRIPT"' EXIT
cd "$ROOT"
BASE_HEAD="$(git rev-parse HEAD)"
SOURCE_DIFF_SHA256="$(git diff --no-ext-diff "$BASE_HEAD" -- "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"
SOURCE_FILES_SHA256_BEFORE="$(shasum -a 256 "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"
test "$SOURCE_DIFF_SHA256" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

sed -e "s#EVIDENCE=\"/tmp/pr6043-overlap-live-evidence\"#EVIDENCE=\"$EVIDENCE\"#" \
  -e 's#test -z "$(git status --porcelain=v1)"#:#' "$BASE_SCRIPT" > "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"
printf 'base_head=%s\nsource_diff_sha256=%s\nsource_files_sha256_before=%s\n' \
  "$BASE_HEAD" "$SOURCE_DIFF_SHA256" "$SOURCE_FILES_SHA256_BEFORE" > "$EVIDENCE/live-working-tree-source.txt"
printf '%s\n' "${SOURCE_PATHS[@]}" >> "$EVIDENCE/live-working-tree-source.txt"
git status --short >> "$EVIDENCE/live-working-tree-source.txt"

bash "$TMP_SCRIPT" | tee "$EVIDENCE/live-watchdog-qa.txt"

SOURCE_FILES_SHA256_AFTER="$(shasum -a 256 "${SOURCE_PATHS[@]}" | shasum -a 256 | awk '{print $1}')"
test "$SOURCE_FILES_SHA256_BEFORE" = "$SOURCE_FILES_SHA256_AFTER"
printf 'source_files_sha256_after=%s\nsource_unchanged_during_qa=yes\n' \
  "$SOURCE_FILES_SHA256_AFTER" >> "$EVIDENCE/live-working-tree-source.txt"
