# Release PR-read retry evidence

## Failure
Four beta.8 publish attempts failed in prepare-release-state on transient GitHub GraphQL HTTP 503. Locations observed: `gh pr list`, merge-state `gh pr view`, and statusCheckRollup `gh pr view`. Runs: 32038803824 (attempts 25 and 9), 32040896810, 32042302206, 32042578880.

## Fix
`retry_gh_read` retries every idempotent PR read (list, state, merge SHA, check rollup, diagnostic rollup) five times with bounded 5-second delays. Write operations remain unchanged.

## Verification
`script/publish-release-bundle-rebuild.test.ts` pins all read callsites; combined workflow tests 15/15 pass, YAML parses, diff-check clean.
