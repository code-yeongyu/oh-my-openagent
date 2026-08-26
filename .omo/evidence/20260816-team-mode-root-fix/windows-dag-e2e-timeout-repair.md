# Windows DAG e2e test timeout repair (PR #6894 CI)

## Failure source

- GitHub Actions run 31941728875 (PR #6894 head e4eb0667b), job 95151839207 (`test (windows-latest, 2/2)`).
- Failed test: `DAG failure, crash, and policy end to end > #given two failures whose completion order
  opposes graph order #when the real engine runs #then ...`, timed out after 5000ms (8188ms).
- The test comes from dev's mass-ulw-dag-orchestration feature (#6865); this PR does not change the DAG
  engine or that test's logic (the only PR edit in the file is the async-start fake in a different test).

## Diagnosis

- Same test on #6865's own Windows CI (jobs 95147917903/95147917862): PASS at 1813ms / 1344ms.
- Same test on this branch's local root run (macOS): PASS at 61.51ms.
- The test drives ~10 poll-driven waits (`whenStarted` x2, 6 settles, `fixture.wait`) through the real
  engine; Windows CI timer slop compounds them past Bun's 5000ms default on a slow runner.
- This is the same Windows-marginal class already repaired by #6896 (windows-soul-watermark-timeout),
  fa6740ae8 (codegraph archive), and this PR's codegraph-provision-upgrade fix.
- Next-slowest DAG tests on the same shard: 2703ms / 2515ms / 2438ms (1.85x headroom); the failing test
  is the unique outlier.

## Fix

- Added `{ timeout: 15_000 }` to the failing test only, matching the established remedy. Assertions and
  production code unchanged.

## Verification

- `bun test packages/senpi-task/src/dag/e2e-failure.test.ts` -> 10 pass / 0 fail.
- `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` -> exit 0.
- Full CI re-run on the new head is the authoritative Windows surface.
