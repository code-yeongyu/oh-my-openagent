# Windows facts failure-store timeout repair

## Canonical evidence location

The required Senpi resolver was run before this follow-up evidence was written. `evidence-path-resolution.txt` records the resolver script, safe slug, and matching repository-relative result.

## Root cause and repair

CI run `33582797101` attempt 1 timed out three Windows facts failure-store persistence cases after 5-6 seconds. A Windows sharing denial can leave a non-lock candidate file behind. The earlier cleanup repair stopped immediate unlink retries, but its one-time per-directory sweep could leave that file unswept for the remainder of a long-lived process.

The repair schedules each directory's advisory sweep once per candidate stale-age window. The immediate next acquisition skips a fresh sharing-blocked candidate. Once eligible, one stale sweep runs; if sharing still blocks it, the directory is not eligible again until the next age window. A non-sharing candidate cleanup error deletes that directory's eligibility entry before it is thrown, so the next acquisition may sweep again. Candidates never establish ownership after hard-link publication, so this changes only advisory cleanup, not mutual exclusion.

## Regression and gate evidence

- `red-resweep-scheduling.log`: the new controlled-clock tests were RED before the scheduler repair. The aged candidate was never revisited, and a non-sharing cleanup error did not rearm the next sweep.
- `green-resweep-scheduling.log`: 7 pass, 0 fail. It proves all four scheduler boundaries without sleeps: fresh deferred cleanup, stale eligibility retry, bounded later eligibility after another sharing failure, and healthy eventual reclamation. It also proves non-sharing rearm before throw.
- `post-cubic-focused.log`: 16 pass, 0 fail across the lock suite and exact facts failure-store file. The file contains 8 persistence cases plus 1 layout case; it includes all three originally timed-out persistence cases.
- `post-cubic-memory-core.log`: 653 pass, 0 fail.
- `post-cubic-typecheck.log`: full repository typecheck passed with repository-pinned Bun 1.4.0.
- `post-cubic-generated-bundle-build.log` and `post-cubic-generated-bundle-check.log`: the committed Senpi extension bundles were regenerated from source and are current.
- `post-cubic-test-senpi.log`: exact captured `bun run test:senpi` output; 2,530 pass, 1 Windows-only skip, 0 fail.
- `post-cubic-senpi-drive-self-test.log` and `post-cubic-senpi-drive-live.json`: isolated real Senpi QA passed. The normalized JSON records ultrawork injection, comment checker success, isolated sandbox use, and unchanged protected host Senpi/OMO state.
- After merging `origin/dev` at `1291b02c1` without a bundle conflict, `post-merge-focused.log` passed 16/16, `post-merge-generated-bundle-check.log` confirmed current bundles, and `post-merge-test-senpi.log` captured 2,530 pass, 1 Windows-only skip, 0 fail. `post-merge-senpi-drive-live.json` records a distinct current live capture with its tested commit, capture ID, timestamp, driver, and runner; it passed with the sandbox absent and no sandbox-referencing child process. `post-merge-evidence-path-resolution.txt` records the actual resolver invocation and normalized result.

The earlier baseline evidence remains for the original failure diagnosis and rebase history. All committed artifact paths are normalized as `<HOME>`, `<WORKTREE>`, or `<TEMP>` where needed; no credentials, host paths, or raw host logs are committed.

## Full-root suite accounting

The local root-suite attempts are not claimed as passing gates. `full-suite-failure-summary.txt` accounts for every one of the 17,169 tests in each attempt, listing all 9 skips and all environmental failures without workstation paths. The authoritative platform proof before this merge was CI run `33610291206`: its two Windows root shards succeeded in 11m10s and 11m07s, and Windows Senpi compatibility succeeded in 11m40s. The final pushed head requires a fresh `ci:full-matrix` Windows run and Cubic review.

## Cleanup and scope

`cleanup-receipt.txt` and `post-merge-driver-cleanup-results.txt` record sandbox and child-process absence separately for the post-merge self-test and current live driver. `post-merge-sandbox-process-investigation.txt` separately documents an earlier driver-associated TypeScript installer that was still alive after the driver returned; its process tree was manually terminated and verified absent. No driver-owned cleanup is claimed for that incident. No OpenCode or Codex production source changed; no real OpenCode or Codex harness was required. The only shipped adapter changes are regenerated Senpi bundles, covered by the Senpi gate and live isolated QA above.
