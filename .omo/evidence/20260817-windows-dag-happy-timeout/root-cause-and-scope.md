# Windows mixed-eight DAG timeout: root cause and fix scope

## Failure

- PR: #6937
- Actions run: `32030280199`
- Original Windows job: `95388592225`
- Test: `packages/senpi-task/src/dag/e2e-happy.test.ts`, mixed-eight / four-wave happy path
- Result: timeout-only failure at `6454ms` against Bun's generic `5000ms` default; `15,678` passed, `73` skipped, and this was the only failure

The job emitted no assertion failure. After Bun marked the test timed out, the same process completed the next two tests successfully at `984ms` and `2031ms`.

## Hypotheses investigated

### 1. Genuine deadlock or event-delivery bug - refuted

`createDagWaitSurface` subscribes to both the durable journal and the live scheduler, then rereads the checkpoint to close the ownership-read/subscription race. The scheduler appends `dag.run.completed` only after every wave has settled. In the failed job, the mixed-eight test returned after `6454ms`, all later tests ran, and there was no assertion failure.

A local Bun 1.3.12 mutation set only this test's timeout to `1ms`. Bun reported the expected timeout at `68.72ms`, but still executed all `81` expectations in the file and the following tests passed. This reproduces the CI failure shape: exact-event completion and assertions are correct; only the harness deadline is too small.

Artifacts:

- `completion-seam.txt`
- `red-timeout-mutation-bun-1.3.12.txt`

### 2. Windows filesystem latency with correct completion - confirmed

This E2E intentionally uses the real crash-safe filesystem store, including synchronous file writes, atomic renames, event-log reads, and fsync-backed persistence. The eight-node case performs the most work in this happy-path file: eight child records/results across four strict waves plus the associated checkpoints and events.

Historical Windows full-shard runs of the identical test completed successfully at:

- `1672ms` - Actions job `95147917862`
- `3297ms` - Actions job `95191504899`
- `6454ms` timeout-only failure - Actions job `95388592225`

The completion mechanism and assertions are unchanged across these runs.

### 3. Full-shard contention against a unit-test default - confirmed

Neighboring DAG tests also vary materially across the same Windows shard runs. In jobs `95147917862` and `95191504899`, linear/diamond moved from `859/985ms` to `1671/2000ms`; the mixed-eight case moved from `1672ms` to `3297ms`. In the reported job, mixed-eight reached `6454ms` while the shard continued normally. This correlated inflation is full-shard Windows I/O contention, not a deterministic graph bug or leaked fixture.

The same test under Bun 1.3.12 in isolation on macOS completed at `82.57ms` with all assertions intact.

Artifact:

- `baseline-focused-bun-1.3.12.txt`

## Exact fix

Give only the mixed-eight test a Windows-specific `15_000ms` budget while preserving the existing `5_000ms` budget on Linux and macOS:

```ts
}, process.platform === "win32" ? 15_000 : 5_000)
```

This is bounded, more than twice the observed `6454ms` loaded-run duration, and scoped to the unique filesystem-heavy outlier. It does not add retries, sleeps, polling, skips, assertion changes, or production behavior.

## Oversized-file rule

`e2e-happy.test.ts` is intentionally marked `SIZE_OK` and measures `344` pure LOC. The fix replaces the existing closing line rather than adding lines, so the file remains `344` pure LOC. A helper extraction would add review surface without changing the single-test timing contract.
