#!/usr/bin/env bash
# Closes the open ci:platform-red issue once a dev push run proves every job it tracks green again, so a recovered dev
# never keeps refusing releases (#14606 stayed open after dev went green and blocked a release dispatch).
#
# The issue lists its jobs as "- [<job>](<url>) on ..." lines and names each red run's commit as "at `<sha>`" in the
# first line of its body and of every comment. A run closes the issue only when both hold:
#   - every listed job ran its tests in this run and succeeded (platform-jobs.jq; a skipped-test leg proves nothing), and
#   - this run's commit is at or after every red commit the issue names, so a slow older green run cannot close a newer red.
# Anything short of that leaves the issue open and says why in the step log.
#
# env: GH_REPO, RUN_ID, RUN_URL, HEAD_SHA, OUT_DIR
set -euo pipefail

platform_jobs_filter="$(cat "$(dirname "$0")/platform-jobs.jq")"
mkdir -p "$OUT_DIR"

issue="$(gh issue list --label ci:platform-red --state open --json number --jq 'map(.number) | min // empty')"
if [ -z "$issue" ]; then
  echo "No open ci:platform-red issue."
  exit 0
fi

gh api "repos/$GH_REPO/actions/runs/$RUN_ID/jobs?filter=latest&per_page=100" --jq "$platform_jobs_filter" > "$OUT_DIR/jobs"
gh issue view "$issue" --json body,comments --jq '[.body] + [.comments[].body] | .[]' > "$OUT_DIR/texts"
gh issue view "$issue" --json body,comments --jq '[.body] + [.comments[].body] | map(split("\n")[0]) | .[]' > "$OUT_DIR/headers"

grep -oE '^- \[[^]]+\]\(' "$OUT_DIR/texts" | sed -E 's/^- \[(.*)\]\($/\1/' | sort -u > "$OUT_DIR/tracked"
grep -oE 'at `[0-9a-f]{7,40}`' "$OUT_DIR/headers" | sed -E 's/^at `(.*)`$/\1/' | sort -u > "$OUT_DIR/red-shas"

if [ ! -s "$OUT_DIR/tracked" ] || [ ! -s "$OUT_DIR/red-shas" ]; then
  echo "#$issue names no job or no red commit this step can check; leaving it open."
  exit 0
fi

while IFS= read -r job; do
  result="$(awk -F '\t' -v n="$job" '$1 == n && !found { print $2; found = 1 }' "$OUT_DIR/jobs")"
  if [ "$result" != success ]; then
    echo "#$issue tracks '$job', which is '${result:-absent}' in this run; leaving it open."
    exit 0
  fi
done < "$OUT_DIR/tracked"

while IFS= read -r red; do
  status="$(gh api "repos/$GH_REPO/compare/$red...$HEAD_SHA" --jq '.status')"
  case "$status" in
    ahead | identical) ;;
    *)
      echo "This run's commit ${HEAD_SHA:0:10} is '$status' of red commit $red, not after it; leaving #$issue open."
      exit 0
      ;;
  esac
done < "$OUT_DIR/red-shas"

{
  echo "Every macOS/Windows job this issue tracks ran its tests and passed on \`dev\` at \`$HEAD_SHA\`, which is at or after every red commit named here."
  echo
  echo "Green run: $RUN_URL"
} > "$OUT_DIR/close.md"
gh issue close "$issue" --comment "$(cat "$OUT_DIR/close.md")"
echo "Closed #$issue."
