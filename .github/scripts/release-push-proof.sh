#!/usr/bin/env bash

# Publish sources this file only from the dispatch commit, extracted next to release-push-proof.mjs and
# release-proof-contract.json; the helper is resolved here, so a later checkout cannot substitute candidate code.
RELEASE_PUSH_PROOF_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/release-push-proof.mjs"

# An exact overall-green push is only a candidate. Keep its run attempt so a
# rerun cannot substitute jobs from a different attempt of the same run.
select_green_push() {
  jq -r --arg sha "$1" '
    [
      .workflow_runs[]
      | select(.event == "push" and .head_sha == $sha and .status == "completed" and .conclusion == "success")
    ]
    | sort_by(.created_at, .id)
    | last
    | select((.id | type) == "number" and (.run_attempt | type) == "number")
    | [.id, .run_attempt, .head_sha] | @tsv
  '
}

# Closed world: every job and step the attempt reports, materialized from ci.yml at its exact SHA, must
# match release-proof-contract.json and have passed (see release-push-proof.mjs).
require_push_validation() {
  local repo="$1" run="$2" id attempt sha jobs workflow
  IFS=$'\t' read -r id attempt sha <<< "$run"
  if ! [[ "$id" =~ ^[1-9][0-9]*$ && "$attempt" =~ ^[1-9][0-9]*$ && "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::Missing or invalid CI run attempt for release push proof." >&2
    return 1
  fi
  if ! jobs="$(gh api --paginate --slurp "repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100")"; then
    echo "::error::Cannot read validation jobs for push CI run ${id}, attempt ${attempt}." >&2
    return 1
  fi
  if ! workflow="$(gh api -H "Accept: application/vnd.github.raw+json" "repos/${repo}/contents/.github/workflows/ci.yml?ref=${sha}")"; then
    echo "::error::Cannot read ci.yml at ${sha} for push CI run ${id}." >&2
    return 1
  fi
  # ci.yml is candidate data: yq only parses it, and only the dispatch-side helper interprets it.
  if ! workflow="$(yq -o=json 'explode(.)' - <<< "$workflow")"; then
    echo "::error::Cannot parse ci.yml at ${sha}; update the release proof contract to a supported ci.yml." >&2
    return 1
  fi
  { printf '{"workflow":%s,"jobs":%s}' "$workflow" "$jobs"; } | node "$RELEASE_PUSH_PROOF_HELPER" "$id" "$attempt" "$sha"
}
