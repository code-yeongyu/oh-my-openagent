#!/usr/bin/env bash
# For every failed macOS/Windows job of a dev push run, walk back the same workflow's earlier dev push runs and
# name the first run where that job went red, so the platform-red issue blames the merge that caused it, not the
# merge that happened to be next (#14555).
#
# env: GH_REPO, RUN_ID, OUT_DIR, PLATFORM_RED_LOOKBACK (earlier runs read, default 30)
# writes: $OUT_DIR/failed.md (one markdown line per failed job; empty when only Linux failed)
#         $OUT_DIR/introduced ("true" when this run is the first red run of at least one job, else "false")
set -euo pipefail

lookback="${PLATFORM_RED_LOOKBACK:-30}"
platform_jobs_filter="$(cat "$(dirname "$0")/platform-jobs.jq")"
cache="$OUT_DIR/runs"
mkdir -p "$cache"
: > "$OUT_DIR/failed.md"
echo false > "$OUT_DIR/introduced"

# One TSV row per macOS/Windows job of a run (see platform-jobs.jq). Read once per run.
platform_jobs() {
  [ -f "$cache/$1" ] && return
  gh api "repos/$GH_REPO/actions/runs/$1/jobs?filter=latest&per_page=100" --jq "$platform_jobs_filter" > "$cache/$1.part"
  mv "$cache/$1.part" "$cache/$1"
}

# The conclusion of one job in one run, from the cache platform_jobs filled.
job_result() {
  awk -F '\t' -v n="$2" '$1 == n && !found { print $2; found = 1 }' "$cache/$1"
}

merged_into() {
  local prs
  prs="$(gh api "repos/$GH_REPO/commits/$1/pulls" --jq '[.[] | select(.merged_at != null) | "#\(.number)"] | join(", ")')"
  echo "${prs:-a direct push}"
}

# Every gh call runs in a plain assignment or statement, never in a process substitution, so a failed read (a rate
# limit, an outage) fails this step instead of reporting no red.
run_row="$(gh api "repos/$GH_REPO/actions/runs/$RUN_ID" --jq '[.workflow_id, .created_at, .head_sha, .html_url] | @tsv')"
IFS=$'\t' read -r workflow_id created_at run_sha run_url <<< "$run_row"
# Newest first: id, head sha, url of the earlier completed dev push runs of the same workflow.
platform_jobs "$RUN_ID"
earlier="$(gh api "repos/$GH_REPO/actions/workflows/$workflow_id/runs?branch=dev&event=push&status=completed&per_page=$lookback" \
  --jq ".workflow_runs[] | select(.created_at < \"$created_at\") | [.id, .head_sha, .html_url] | @tsv")"

while IFS=$'\t' read -r name conclusion url labels; do
  [ "$conclusion" = failure ] || continue
  first_sha="$run_sha" first_url="$run_url" green_sha="" gap=0
  while IFS=$'\t' read -r id sha html; do
    [ -n "$id" ] || continue
    platform_jobs "$id"
    case "$(job_result "$id" "$name")" in
      failure) first_sha="$sha" first_url="$html" gap=0 ;;
      success) green_sha="$sha"; break ;;
      *) gap=$((gap + 1)) ;;
    esac
  done <<< "$earlier"
  [ "$first_sha" != "$run_sha" ] || echo true > "$OUT_DIR/introduced"
  line="- [$name]($url) on \`$labels\`: first red after merging $(merged_into "$first_sha") at \`${first_sha:0:10}\` ([run]($first_url))"
  if [ -z "$green_sha" ]; then
    line="$line; no green run in the last $lookback runs"
  elif [ "$gap" -gt 0 ]; then
    line="$line; $gap run(s) before it have no result for this job, so the cause is in https://github.com/$GH_REPO/compare/$green_sha...$first_sha"
  else
    line="$line; green at the commit before (\`${green_sha:0:10}\`)"
  fi
  echo "$line" >> "$OUT_DIR/failed.md"
done < "$cache/$RUN_ID"
