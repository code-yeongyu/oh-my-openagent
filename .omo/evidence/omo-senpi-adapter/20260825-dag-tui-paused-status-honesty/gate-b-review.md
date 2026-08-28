# Gate B review record (self-review, five lenses)

The `review-work` skill (5 parallel reviewer subagents) is not present in this
environment and this task child cannot dispatch subagents, so the equivalent
review was performed directly on `git diff origin/dev...HEAD`. Findings below.

## Lens 1 — goal verification: PASS

The display contract is implemented exactly as specified. Priority order
verified in `pausedStatusText`:

1. `run.status === "paused"` AND `leaseHolderPid` present AND pid alive
   (signal-0, `ESRCH` caught, `EPERM` counts alive via `code !== "ESRCH"`)
   -> `resuming`.
2. No live lease AND >= 1 node in state `running` -> `suspended · N active`
   with N = running node count.
3. Otherwise -> `paused`.

Run-level icon for the whole family is the neutral `·`, never `⏸`
(`PAUSED_RUN_ICON` short-circuits `NODE_ICONS`). Node-level `▶` for running
lanes is untouched. `leaseHolderPid` is threaded through
`senpi-task/src/dag/manager.ts projectSnapshot` (and `handle.ts projectSnapshot`
for parity) and `omo-senpi/dag-snapshot-payload.ts`, each with tests.

## Lens 2 — QA evidence: PASS

Red captures committed (3 failing display rules, 6 typecheck errors, 1 failing
payload case), green captures, live before/after driver JSON, isolation proof,
and pre-existing-failure attribution. The evidence README covers
what-tested / observed / why-enough / omitted.

## Lens 3 — code quality: one finding, fixed

The QA driver carried a dead `isAliveOverride` parameter plus a `void` no-op
left over from an earlier draft. Fixed in 7cf5c476 (parameter removed); the
driver re-runs PASS and `tsgo -p packages/omo-senpi` stays clean. The remaining
casts (`runId as DagRunId`, a fake `setWidget` object) mirror the wiring the
adapter itself uses in `dag-runtime.ts` and exist only to satisfy the widget's
host-side seam from a standalone script.

Shipped-code diff is minimal: two optional fields on `DagRunRecordV1`
(collapsing an existing cast in `liveLeaseHolder`), one optional field each on
`DagRunSnapshot` and the bridge snapshot, two spread-guarded projections, and
the formatter change. No engine, WAL, checkpoint, scheduler, or recovery code
was touched.

## Lens 4 — security: PASS

No new input surface, no secret handling, no logging additions. The pid comes
from the engine's own checkpoint (same trust domain as the existing
`liveLeaseHolder` / `node-control-context` guards that already decide real
control flow on it). The signal-0 probe cannot deliver a signal. Adding a pid
to the `omo.dag.updated` payload matches the trust domain of existing task
payloads that already expose host pids to the same viewer.

## Lens 5 — context mining: PASS, one note

Searched for other render sites of run status. `dag-commands.ts:193` prints raw
status in a one-line `/dag` list with no per-node rows, so it cannot produce the
paused-header-vs-running-lane contradiction this PR targets; the `/dag` tool
messages likewise report the factual record status to the model. Both are out of
the display contract's stated scope (the TUI run header), and the wire payload
now carries `lease_holder_pid` so a GUI viewer can implement the same
distinction. No other consumer was found that renders the paused family with
per-node rows.

## Verdict

Gate B: PASS after one self-found fix.

## Gate C record: SKIPPED (quota/availability)

No `cubic-dev-ai[bot]` review ever appeared on PR #7322: the review list is
empty and Cubic's own check entry reports `skipping` (3s). A bounded wait of 5
minutes after the PR went up produced zero reviews. Per the work-with-pr loop
this is the one sanctioned skip condition, recorded rather than silently
passed. Issues were never a reason to skip and none were found by any other
gate.
