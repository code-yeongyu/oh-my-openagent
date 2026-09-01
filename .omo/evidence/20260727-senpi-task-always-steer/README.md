# senpi-task always-steer evidence

## Scope

- Tier: HEAVY
- Reason: public `task_send` schema and task-session message delivery semantics change.
- Branch: `fix/senpi-task-always-steer`
- Baseline: `origin/dev` at `f2ae25041`

## Success criteria

1. `task_send` exposes no `deliver_as` property and plain child messages request steer unconditionally.
2. Running-child and finished-resident behavior works through the real task surface without a delivery option.
3. Focused tests, senpi compatibility, typecheck, build, and changed-file diagnostics are clean.
4. Reviewer approves and the PR is merged with the repository-required merge commit.

## Planned exact scenarios

### Focused RED/GREEN

Command:

```bash
bun test packages/senpi-task/src/tools/control/send-always-steer.test.ts packages/senpi-task/src/tools/control/renderers.test.ts
```

PASS: exit code 0 after implementation. RED: assertions fail before production edits because `deliver_as` is still present, default sends reach the engine as `followUp`, or the renderer prints `deliver:`.

### Real task surface

Invocation:

```text
task({ prompt: "Report WORKING, wait for a steering instruction, then return the exact steered text.", subagent_type: "explore", run_in_background: true, name: "always-steer-running" })
task_send({ to: "always-steer-running", message: "STEER-PROBE-RUNNING" })
task_output({ name: "always-steer-running", mode: "full" })
```

PASS: the send invocation contains no delivery option, the result reports steer delivery, and the child transcript contains `STEER-PROBE-RUNNING`.

Finished resident invocation:

```text
task({ prompt: "Return RESIDENT-FIRST and stop.", subagent_type: "explore", name: "always-steer-resident" })
task_send({ to: "always-steer-resident", message: "Return RESIDENT-REVIVED and stop." })
task_output({ name: "always-steer-resident", mode: "full" })
```

PASS: the second invocation contains no delivery option, revives the same task id/session, and the transcript contains `RESIDENT-REVIVED`.

## Observations

Pending.

## Why this is enough

Pending.

## Cleanup receipts

Pending.

## Omitted

Secret-bearing environment values, provider credentials, and raw private logs will not be copied into evidence.
