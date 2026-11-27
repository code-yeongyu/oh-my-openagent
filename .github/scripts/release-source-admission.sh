#!/usr/bin/env bash

# Admission of a pinned release source (source_sha). publish.yml runs it read-only before anything is written or
# dispatched for that source (pin-ci) and again in gate-reuse, from the dispatch commit's checkout (full history), so
# both judge the same canonical SHA. Exits the step on refusal; on success SOURCE_SHA holds the canonical lowercase SHA.
# env: SOURCE_SHA, LAZYCODEX_ONLY, CI_BASIS_RECEIPT, PREPARED_RELEASE_SHA, GITHUB_SHA
admit_release_source() {
  if ! [[ "$SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]] ||
    [ "$LAZYCODEX_ONLY" = true ] || [ -n "$CI_BASIS_RECEIPT" ]; then
    echo "::error::source_sha requires a full commit SHA, a version stamp, and hosted push CI."
    exit 1
  fi
  SOURCE_SHA="$(git rev-parse --verify "$SOURCE_SHA")"
  if [ "$(git cat-file -t "$SOURCE_SHA")" != commit ] || ! git merge-base --is-ancestor "$SOURCE_SHA" origin/dev; then
    echo "::error::source_sha ${SOURCE_SHA} is not on dev."
    exit 1
  fi
  if ! git merge-base --is-ancestor refs/remotes/origin/master "$SOURCE_SHA"; then
    echo "::error::Pinned source ${SOURCE_SHA} does not contain origin/master; refusing a release that cannot fast-forward the mirror."
    exit 1
  fi
  if [ -n "$PREPARED_RELEASE_SHA" ] && {
    [ "$PREPARED_RELEASE_SHA" != "$GITHUB_SHA" ] ||
    [ "$(git rev-parse HEAD^1)" != "$SOURCE_SHA" ] ||
    ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" origin/dev;
  }; then
    echo "::error::The prepared source must be a merged stamp whose first parent is ${SOURCE_SHA}."
    exit 1
  fi
}
