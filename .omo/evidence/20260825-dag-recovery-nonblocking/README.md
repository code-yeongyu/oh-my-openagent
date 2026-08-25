# DAG session-restart recovery is non-blocking

Incident: `dag_530ad299` (sisyphuslabs "omo startup fixes PR wave"), 2026-08-25.
Branch: `fix/dag-recovery-nonblocking`. Baseline: `origin/dev` @ `b9c04adbd`.

## WHAT WAS TESTED

The session-restart resume path of the DAG engine (`packages/senpi-task/src/dag/recovery.ts`)
when a paused run still owns a child that survived the restart and keeps running.

Surfaces driven:

| Command | Purpose |
|---------|---------|
| `bun test packages/senpi-task/src/dag/recovery-nonblocking.test.ts` | The new regression, RED on pristine `origin/dev` and GREEN on the branch |
| `bun test packages/senpi-task` | Package gate (the scoped gate for this change) |
| `tsgo --noEmit -p packages/senpi-task/tsconfig.json` | Type gate |
| `bun test packages/omo-senpi/src/components/task` | The consumer that wires `createDagRecovery` + `createDagScheduler` |

## WHAT WAS OBSERVED

### The defect, on pristine `origin/dev` (`red-origin-dev.txt`)

`reconcileNodes` handled a node still in state `running` by calling
`context.taskManager.waitFor(task.task_id)` INSIDE the reconcile loop, and
`dagRunResumedEvent` was appended only AFTER `reconcileNodes` returned. So with one
long-running child:

- the run stayed `status: "paused"` for as long as that child ran,
- `dag.run.resumed` never committed,
- reuse events for completed nodes ordered AFTER the running node never committed
  (production journal froze after the first `dag.node.reused`; see
  `baseline-repro/journal-dag_530ad299-*.jsonl`),
- `amend` / `retry` refused the whole time with `amend_running_node` / `run_still_active`.

The regression test bounds its wait for the two boundary events and reports which ones never
arrived, so the RED is an assertion, not a suite timeout:

```
expect(received).toEqual(expected)
- []
+ [
+   "dag.node.reused",
+   "dag.run.resumed",
+ ]
```

### After the change (`green-branch.txt`)

Both boundary events commit while the reattached child is STILL running:

- `store.readCheckpoint(runId).status === "running"` mid-flight,
- the reattached node is still `running` and `manager.get("task-slow").status === "running"`,
- `reattach` still fires for the surviving child,
- once the child settles it folds through the normal wave await, so the
  `DagRecoveryOutcome` contract is unchanged: `kind: "resumed"`, `reusedOutputs` carries the
  durable output, the final record is `completed`, and only the never-dispatched node started.

Test time drops from a 5s bounded deadline (RED) to ~30ms (GREEN) because the GREEN path
resolves on the journal commit, never on a timer.

### Gates

| Gate | Result | Artifact |
|------|--------|----------|
| `bun test packages/senpi-task` | 1744 pass / 1 skip / **0 fail** (1745 across 247 files) | `gate-senpi-task.txt` |
| `tsgo --noEmit -p packages/senpi-task/tsconfig.json` | clean, exit 0 | `gate-typecheck.txt` |
| `bun test packages/omo-senpi/src/components/task` | 478 pass / **0 fail** | `gate-omo-senpi-task-component.txt` |

Every pre-existing DAG recovery test still passes unmodified: none was weakened, skipped, or
deleted. In particular `recovery.test.ts`'s "completed work is reused, the running child folds,
and the incomplete wave resumes" still asserts `waitForCalls` contains the reattached task, the
`reattach` callback fired, and every node reached `completed` - the fold simply happens in the
scheduler's wave await instead of inside reconcile.

## WHY IT IS ENOUGH

The regression pins the exact production symptom (the two boundary events withheld while a
child runs) at the exact seam that produced it, with a fixture shaped like the real checkpoint:
the still-running node ordered FIRST, a completed sibling with a durable result, and a pending
dependent. It is event-driven - it subscribes to the run's journal BEFORE resume starts and
replays already-committed events from the WAL - so it cannot pass by timing luck and cannot
miss an event. It fails on pristine `origin/dev` and passes on the branch, and removing the fix
restores the RED.

A second test guards the new `preAttachedTasks` option at the re-entry seam: `reenterDagRun`
drops it, because those ids describe children that were live for the PREVIOUS scheduler, and
re-attaching a settled task folds its outcome onto the node twice. Verified by reverting the
strip, which produces a spurious `completed -> completed` transition on the reattached node.

Scope held: `runWaves`'s strict wave barrier (`scheduler.ts`) is untouched. A pre-attached
child is folded through the SAME `settleOne` path as an admitted one, so the barrier is at most
stricter, never looser - a follow-up lane owns barrier semantics.

## WHAT WAS OMITTED

- Test R2 from the baseline repro (`baseline-repro/dag-stall-repro.test.ts`) is NOT adapted
  here. It asserts that a dependent whose `dependsOn` are all completed is admitted while an
  unrelated wave-0 sibling still runs - that is the strict-barrier semantics change, explicitly
  owned by a different lane and out of scope for this PR. It remains RED on this branch by design.
- No live Senpi driver run. This change is engine-internal to `packages/senpi-task/src/dag/`
  and is proven through the package suite plus the omo-senpi task component that wires it; no
  adapter, tool schema, prompt, or config surface changed.
- `bun test packages/omo-senpi` (the whole adapter) reports failures in
  `createInitDeepAdvisorComponent`, `cli-local`, `OmO Native product identity`, and
  `session_start component ordering`. These are PRE-EXISTING base-branch defects, not caused by
  this change: pristine `origin/dev` @ `b9c04adbd` reports **31 fail / 3 errors** on the same
  command, MORE than this branch. None of them touch a DAG path, and the DAG consumer directory
  is 0 fail (`gate-omo-senpi-task-component.txt`).
- Raw journal evidence from the live incident is copied verbatim under `baseline-repro/`; it
  contains no secrets, tokens, or credentials.

## FILES

| Path | Contents |
|------|----------|
| `red-origin-dev.txt` | Regression test failing on pristine `origin/dev` @ `b9c04adbd` |
| `green-branch.txt` | Same test passing on this branch |
| `gate-senpi-task.txt` | `bun test packages/senpi-task` |
| `gate-typecheck.txt` | `tsgo --noEmit` (empty = clean) |
| `gate-omo-senpi-task-component.txt` | `bun test packages/omo-senpi/src/components/task` |
| `baseline-repro/dag-stall-repro.test.ts` | Original failing-first repro (R1 + R2) |
| `baseline-repro/red-output.txt` | Its original RED output |
| `baseline-repro/journal-dag_530ad299-*.jsonl` | Live incident journal showing the frozen run |
