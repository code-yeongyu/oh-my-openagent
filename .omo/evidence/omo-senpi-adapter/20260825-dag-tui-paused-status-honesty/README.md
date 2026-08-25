# DAG TUI run-header honesty for paused runs

Branch `fix/dag-tui-paused-status-honesty`. Display and snapshot projection only:
no engine semantics, WAL event vocabulary, checkpoint format, scheduler, or
recovery behavior changed.

## The bug

A DAG run paused by session shutdown rendered its header from the raw
`run.status`, so during the resume-reconcile window the widget printed

```
⏸ ship-it paused wave 1/1 0/2 done, 1 running
  ▶ alpha · category:quick · 0s
```

The header claimed the run was paused and idle while the lane directly beneath
it claimed to be running. Both cannot be true. The information that resolves the
contradiction (`leaseHolderPid`, written by `claimPausedRun` and cleared on
shutdown pause) never left the checkpoint record, so no display surface could
read it.

## The contract implemented

Resolved in priority order when `run.status === "paused"`:

| Condition | Header status text |
|---|---|
| `leaseHolderPid` present AND that pid is alive | `resuming` |
| no live lease AND >= 1 node in state `running` | `suspended · N active` (N = running node count) |
| otherwise | `paused` |

The run-level icon for that whole family becomes the neutral `·`, never `⏸`.
Node-level `▶` for genuinely running lanes is unchanged. Liveness is a signal-0
probe: `ESRCH` means gone, `EPERM` still counts as alive.

## What was tested

1. **Failing-first unit tests** (three display-rule cases) added to the existing
   `packages/omo-senpi/src/components/task/dag-status-row-format.test.ts` before
   any implementation, plus two payload cases in `dag-snapshot-payload.test.ts`.
2. **Live QA on the real render surface**, not the pure formatter:
   `packages/omo-senpi/scripts/qa/dag-paused-header-qa.ts` drives a real on-disk
   `DagFileStore`, the real `createDagRecovery().pauseRunsForShutdown` write, a
   real lease claim, the real `createDagManager` snapshot projection, and the
   real `createDagStatusUi` widget render, capturing the rows the TUI would set.
   The lease holder is a genuinely spawned OS process, killed mid-run with
   SIGKILL so the dead-lease branch is exercised against a real pid rather than
   a stubbed predicate.
3. **Scoped package gates**: `tsgo --noEmit` for both touched packages, the
   `omo-senpi` task component suite, and the `senpi-task` dag suite.

## What was observed

### Before (base b9c04adbd, formatter reverted, same driver)

`before/dag-paused-header-qa.json` — result **FAIL**, 7 contract violations:

```
resuming_header:  "⏸ ship-it paused wave 1/1 0/2 done, 1 running"
suspended_header: "⏸ ship-it paused wave 1/1 0/2 done, 1 running"
paused_header:    "⏸ ship-it paused wave 1/1 0/2 done"
```

All three situations rendered identically, reproducing the reported lie.

### After (this branch)

`after/dag-paused-header-qa.json` and `after-live-dag-header.txt` — result **PASS**,
zero failures:

```
resuming_header:  "· ship-it resuming wave 1/1 0/2 done, 1 running"
suspended_header: "· ship-it suspended · 1 active wave 1/1 0/2 done, 1 running"
paused_header:    "· ship-it paused wave 1/1 0/2 done"
resuming_rows[1]: "  ▶ alpha · category:quick · 0s"    <- node icon unchanged
```

### Red / green captures

| Artifact | Result |
|---|---|
| `red-dag-status-row-format.txt` | 12 pass, **3 fail** — the three display rules, before implementation |
| `red-typecheck-omo-senpi.txt` | 6 errors: `leaseHolderPid` / `isProcessAlive` not yet on the types |
| `red-dag-snapshot-payload.txt` | 9 pass, **1 fail** — `lease_holder_pid` not on the wire |
| `green-dag-display-tests.txt` | 25 pass, 0 fail |
| `green-typecheck.txt` | `tsgo -p packages/omo-senpi` exit 0, `tsgo -p packages/senpi-task` exit 0 |
| `green-omo-senpi-task-component.txt` | 483 pass, 0 fail (63 files) |
| `green-senpi-task-dag-tests.txt` | 243 pass, 0 fail (16 files) |
| `green-scoped-suites.txt` | 726 pass, 0 fail (79 files) — both scopes together |

### Isolation

`isolation-proof.txt`. The driver's entire filesystem write surface is its own
`mkdtempSync` state dir plus the explicit out-dir; it never reads or writes an
agent directory. A whole-directory watch over `~/.senpi/agent` and `~/.omo/agent`
showed 25 paths changing during the driver run, but a **control window with no
driver running showed 29** — the churn is this machine's own live agent session
(its session JSONL, MCP logs, debug log), not the driver. No sandbox was left
behind (`dag-paused-header-qa-*` temp dirs are removed in `finally`).

## Why it is enough

The three contract rules are proven at the surface a user actually sees: rows
handed to `ui.setWidget` by the real widget, fed by the real snapshot projection,
fed by a real checkpoint that the real recovery code paused. The lease-liveness
branch is decided by a real pid transitioning from alive to killed inside one
run, so it cannot pass by stub agreement. The before/after pair uses the *same*
driver against the *same* store shape, so the delta is attributable to the
formatter change alone. Failing-first captures prove the tests actually gate the
behavior rather than being written to match a finished implementation.

Regression risk is bounded by scope: the only non-display change is the addition
of an optional `leaseHolderPid` to `DagRunRecordV1` (which recovery already wrote
via a local cast) and its projection into `DagRunSnapshot` / the
`omo.dag.updated` payload. Both are additive and absent when no lease is held;
the existing omo-desktop-app reducer-contract test still pins the untouched field
set for a plain run.

## What was omitted

- **No live `senpi` binary session.** This change never reaches a model, a
  provider, or a session prompt — it renders a widget from a checkpoint. Driving
  a full `senpi` run would exercise none of the three rules, because reproducing
  a live lease race inside a real session is nondeterministic; the driver instead
  reproduces it deterministically at the exact seam that renders.
- **`bun run test:senpi` reports 14 failures, 13 of which are pre-existing** and
  unrelated (`init-deep-advisor`, `cli-local` install round-trip, OmO native
  identity). `baseline-preexisting-failures.txt` captures 11 of them reproducing
  with this branch's changes stashed. The 14th was
  `dag-status-ui > each state renders its own icon`, which asserted the old
  `⏸` run-header contract; it was updated to the new contract (its node-icon
  assertions unchanged), not deleted.
- No secrets, tokens, auth headers, env dumps, or credentials appear in any
  artifact. Temp paths and a transient child pid are the only machine-specific
  values recorded.

## Post-rebase re-verification

PR #7320 (`fix/dag-recovery-nonblocking`, touching `recovery.ts`, `scheduler.ts`,
and the tracked `omo-task.js` bundle) merged to dev while this PR was in review,
making the branch conflicting. Resolved per the smart-rebase contract: the only
conflict was the generated bundle, resolved by regenerating it from this branch's
source; no semantic conflict existed.

Re-verified on the rebased tree against the new dev:

- `tsgo -p packages/senpi-task` and `tsgo -p packages/omo-senpi` both exit 0.
- `green-post-rebase.txt`: 728 pass / 0 fail across the omo-senpi task component
  and senpi-task dag suites (the two extra tests vs the earlier 726 are dev's
  new `recovery-nonblocking` cases, now running in the shared scope).
- `post-rebase/dag-paused-header-qa.json`: the live driver still PASSes with the
  same honest headers; the lease write/read path in the changed `recovery.ts`
  still carries `leaseHolderPid` (write at claim, clear on shutdown pause).
