# Windows root-shard diagnostics (#10814)

The profile is off by default. `WINDOWS_SHARD_PROFILE` is `1` only for a
`workflow_dispatch` run of `ci.yml` with `shard_profile=true`, or for a pull
request carrying the `ci:windows-profile` label (labels do not trigger CI: add
it, then push or re-run). Every other push, PR, merge-queue and reusable run
keeps the unprofiled launch path (no sampler, preload wrapper or timing flags),
so the runs the acceptance streak counts are not perturbed by the measurement.

Sampling is one long-lived process per invocation: a single `pwsh` loop
(`ci-test-processes.ps1`) prints one compressed JSON process table every two
seconds and exits by itself once the collector is gone. There is no cold
PowerShell start per sample. Each sample records the sampler's PID, and the
profile keeps the sampler's own last-seen row, so its cumulative CPU time is
part of the evidence.

When enabled, both Windows root shards collect the same measurements. The
serial quarantine stays serial; the rpc-host and remainder invocations keep
their existing partition, isolation, crash-wrapper policy and timeout budgets.
Telemetry never decides the test outcome:

- The wrapper first runs `ci-test-telemetry.mjs --preflight`; if the collector
  cannot load, the tests run unprofiled and a `profile preflight` error lands in
  the boundary snapshot.
- If profile setup fails (unreadable bunfig, unexpected `preload` shape or
  arguments), the collector records a `setup` capture error and runs the
  original test arguments unchanged. Such a profile has `fallback: true` and
  does not count as a comparison leg.
- The non-required `Report Windows shard profile` step (`continue-on-error`)
  judges the profiles and exits non-zero on a missing, fallback, sample-less or
  erroring profile, so a telemetry failure is visible without failing a
  required test step.

`comparison_sha` must be a full 40-character lowercase SHA; anything else fails
the `ci-mode` job before tests start.

After this workflow is available on a dispatchable ref, run both legs against
the **same full commit SHA containing these diagnostics**:

```sh
gh workflow run ci.yml --repo code-yeongyu/oh-my-openagent --ref <diagnostic-branch> \
  -f comparison_sha=<full-diagnostic-sha> -f windows_workers=4 -f shard_profile=true
gh workflow run ci.yml --repo code-yeongyu/oh-my-openagent --ref <diagnostic-branch> \
  -f comparison_sha=<full-diagnostic-sha> -f windows_workers=2 -f shard_profile=true
```

The test jobs check out `comparison_sha`, not a moving branch. Other CI jobs
still validate the dispatched workflow ref. Separate worker-count concurrency
groups prevent the two dispatches from cancelling each other. Push, PR and
reusable CI callers keep the default of four file workers.

Download each `windows-root-test-telemetry-<run>-<attempt>-<shard>-workers-<N>`
artifact. Per invocation it includes the existing boundary snapshot plus:

- `*-samples.jsonl`: approximately two-second host CPU utilization, available
  physical memory, test-tree RSS, descendant counts and process inventories
  (PID, parent PID, creation time, executable basename and resource counters).
  Windows process CPU time is cumulative milliseconds; macOS's dry-run probe
  reports `ps` CPU percent instead. No command lines or environments are collected.
- `*-preload.jsonl`: evaluation duration of each original preload import, in
  original order, tagged with PID and Bun worker ID. Parallel isolation still
  re-evaluates preloads for each file. These totals overlap across workers.
- `*-files.json`: Bun's native per-file wall timings. The file starts absent,
  so timing collection never feeds previous measurements into scheduling.
- `*-profile.json`: exact tested SHA, configured/observed workers, machine
  capacity, capture errors/coverage, peaks and native file timings.

The job summary includes capture coverage, peaks and the ten slowest files.
Missing/incomplete timings or sampling errors are explicitly reported. Partial
JSONL samples survive a crash; a hard job cancellation can prevent final
aggregation or artifact upload. Sampling misses short-lived/reparented children
and is not an I/O profiler. Compare distributions and repeated first-attempt
outcomes, not a single peak or green run. Existing rpc-host crash handling is
unchanged; its retry notices remain in the job log and do not count as
first-attempt evidence.

This PR is diagnostic only. The follow-up fix must demonstrate ten consecutive
completed, non-cancelled, first-attempt green Windows shard-2 runs on dev, with
all three invocations executed and no unhandled errors or unexpected temp leaks.
Diagnostic dispatches do not satisfy that acceptance streak.
