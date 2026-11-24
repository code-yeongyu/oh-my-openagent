#!/usr/bin/env bash
# Closes the open ci:platform-red issue once every macOS/Windows job it names is green again on dev, so a recovered dev
# never keeps refusing releases (#14606 and #14801 stayed open after dev went green and blocked release dispatches).
#
# The issue lists its jobs as "- [<job>](<job url>) on ..." lines under a first line naming the red run's commit as
# "at `<sha>`", in its body and in every comment. A job's newest such block gives its red commit and, from the job url,
# the run, hence the workflow, it belongs to. One issue can name jobs from several workflows (CI and Computer engine for
# #14801), and a run of one workflow never contains another workflow's jobs, so each job is judged on the latest
# completed dev push run of its OWN workflow. The issue closes only when, for every named job, that run:
#   - ran the job's tests and it succeeded (platform-jobs.jq; a skipped-test leg proves nothing), and
#   - is at or after the job's red commit, so a run that has not re-run since the red cannot close it.
# Anything short of that leaves the issue open and says why in the step log.
#
# env: GH_REPO, RUN_URL (the run that triggered this check), OUT_DIR
set -euo pipefail

platform_jobs_filter="$(cat "$(dirname "$0")/platform-jobs.jq")"
mkdir -p "$OUT_DIR"

issue="$(gh issue list --label ci:platform-red --state open --json number --jq 'map(.number) | min // empty')"
if [ -z "$issue" ]; then
  echo "No open ci:platform-red issue."
  exit 0
fi

# One "<job>\t<run id>\t<red sha>" row per named job, from the newest block that lists it.
gh issue view "$issue" --json body,comments --jq '
  [ ([.body] + [.comments[].body])[]
    | split("\n") as $lines
    | (first($lines[0] | capture("at `(?<sha>[0-9a-f]{7,40})`") | .sha) // null) as $sha
    | select($sha != null)
    | $lines[]
    | capture("^- \\[(?<job>[^]]+)\\]\\([^)]*/actions/runs/(?<run>[0-9]+)/")
    | {job, run, sha: $sha} ]
  | reduce .[] as $entry ({}; .[$entry.job] = $entry)
  | .[]
  | [.job, .run, .sha]
  | @tsv' > "$OUT_DIR/tracked"

if [ ! -s "$OUT_DIR/tracked" ]; then
  echo "#$issue names no job with a red commit this step can check; leaving it open."
  exit 0
fi

evidence=""
while IFS=$'\t' read -r job red_run red_sha; do
  workflow="$(gh api "repos/$GH_REPO/actions/runs/$red_run" --jq '.workflow_id')"
  read -r run run_sha green_run_url < <(gh api "repos/$GH_REPO/actions/workflows/$workflow/runs?branch=dev&event=push&status=completed&per_page=1" \
    --jq '.workflow_runs[0] | "\(.id) \(.head_sha) \(.html_url)"')
  jobs="$OUT_DIR/jobs-$run"
  [ -f "$jobs" ] || gh api "repos/$GH_REPO/actions/runs/$run/jobs?filter=latest&per_page=100" --jq "$platform_jobs_filter" > "$jobs"
  result="$(awk -F '\t' -v n="$job" '$1 == n && !found { print $2; found = 1 }' "$jobs")"
  if [ "$result" != success ]; then
    echo "#$issue tracks '$job', which is '${result:-absent}' in its workflow's latest dev push run $run; leaving it open."
    exit 0
  fi
  status="$(gh api "repos/$GH_REPO/compare/$red_sha...$run_sha" --jq '.status')"
  case "$status" in
    ahead | identical) ;;
    *)
      echo "'$job' passed in run $run at ${run_sha:0:10}, which is '$status' of its red commit ${red_sha:0:10}, not after it; leaving #$issue open."
      exit 0
      ;;
  esac
  evidence+="- \`$job\`: passed in $green_run_url at \`${run_sha:0:10}\`, after its red commit \`${red_sha:0:10}\`"$'\n'
done < "$OUT_DIR/tracked"

{
  echo "Every macOS/Windows job this issue tracks ran its tests and passed on \`dev\` in the latest push run of its own workflow, at or after the commit it was red at:"
  echo
  printf '%s' "$evidence"
  echo
  echo "Checked after: $RUN_URL"
} > "$OUT_DIR/close.md"
gh issue close "$issue" --comment "$(cat "$OUT_DIR/close.md")"
echo "Closed #$issue."
