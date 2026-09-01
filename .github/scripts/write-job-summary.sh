#!/usr/bin/env bash
set -euo pipefail

summary_file="${GITHUB_STEP_SUMMARY:-}"
if [ -z "$summary_file" ]; then
  echo "GITHUB_STEP_SUMMARY is not set" >&2
  exit 1
fi

title="${JOB_SUMMARY_TITLE:-${GITHUB_JOB:-GitHub Actions job}}"
status="${JOB_SUMMARY_STATUS:-unknown}"
details="${JOB_SUMMARY_DETAILS:-No job details were provided.}"
next="${JOB_SUMMARY_NEXT:-Open the failed step log and rerun the job after fixing the first reported error.}"
workflow="${GITHUB_WORKFLOW:-unknown}"
event="${GITHUB_EVENT_NAME:-unknown}"
ref="${GITHUB_REF_NAME:-unknown}"
sha="${GITHUB_SHA:-unknown}"
short_sha="${sha:0:12}"
repository="${GITHUB_REPOSITORY:-unknown}"
run_id="${GITHUB_RUN_ID:-}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"

run_url=""
if [ -n "$run_id" ] && [ "$repository" != "unknown" ]; then
  run_url="https://github.com/${repository}/actions/runs/${run_id}/attempts/${run_attempt}"
fi

escape_table_value() {
  printf '%s' "$1" | tr '\n' ' ' | sed 's/|/\\|/g'
}

{
  printf '## %s\n\n' "$title"
  printf '| Field | Value |\n'
  printf '| --- | --- |\n'
  printf '| Result | `%s` |\n' "$(escape_table_value "$status")"
  printf '| Workflow | `%s` |\n' "$(escape_table_value "$workflow")"
  printf '| Event | `%s` |\n' "$(escape_table_value "$event")"
  printf '| Ref | `%s` |\n' "$(escape_table_value "$ref")"
  printf '| Commit | `%s` |\n' "$(escape_table_value "$short_sha")"
  printf '\n'
  printf '### What this job checks\n\n'
  printf '%s\n\n' "$details"
  printf '### If this fails\n\n'
  printf '%s\n\n' "$next"
  if [ -n "$run_url" ]; then
    printf '[Open run](%s)\n\n' "$run_url"
  fi
} >> "$summary_file"
