---
name: ulw-loop
description: "A goal-like loop that decomposes work into systematic, evidence-bound ultrawork steps. Use when the user wants a goal loop or durable, checkpointed execution."
metadata:
  short-description: Goal-like ultrawork loop for systematic decomposition
---

# ulw-loop

Use this skill when the user asks for `ulw-loop`, `ulw`, durable goal execution, evidence-led work, manual QA, or checkpointed long-running delivery.

This skill is compact by design: the run contract below is the whole bootstrap. `references/full-workflow.md` and `references/define-goal.md` carry the full doctrine; open a section only when the phase you are in needs it.

## Run contract

1. Create goals from a JS eval cell: `agentToolkit.createGoals({ brief })` after the SDK import below. The SDK binds this session from the host env, so never pass a session id or a plan path. If the envelope reports `ULW_LOOP_PLAN_EXISTS_COMPLETE` (this session's aggregate is already complete), unrelated new work needs a fresh session; `createGoals({ brief, force: true })` is only for deliberately overwriting completed evidence.
2. Register the aggregate objective from the returned handoff with `create_goal`, shaped by `references/define-goal.md`. Goal creation is NEVER skipped.
3. Mirror every atomic step into the live `todo` checklist: one granular step per action, exactly one in_progress, transitions marked the instant they happen.
4. Treat each goal as a phase: create its own worktree off the integration base; dispatch its dependency-ordered lanes as ONE `workflow` run (read the mass-ulw skill first; ordering-free lanes stay a `task` batch); verify every criterion with real-surface evidence; land the worktree on the integration base at `agentToolkit.checkpoint({ goalId, status: "complete", evidence })` per the repository's flow (direct merge or merged PR); define the next goal's run from what this one proved. Tests alone never prove done. When a mass-ulw pointer accompanies this skill, this contract still owns goals, criteria, evidence, and checkpoints.
5. Stop when the goal's WHEN-TO-STOP line holds with evidence in hand.

When the injected ultrawork directive accompanies this skill, its goal/notepad/todo bootstrap is subsumed by this contract: the loop SDK owns goal state and the loop ledger is the notepad. Do not create a second one.

## The SDK: one import, then method calls

Every ulw-loop operation runs inside a JS eval cell through the SDK the extension publishes at `OMO_AGENT_TOOLKIT_SDK_ROOT`. There is no `omo_agent_toolkit` tool and no CLI to spawn on Senpi.

```js
const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)
print(await agentToolkit.status())
```

Rules that keep it working:

- JS cells only. From a py, rb, or jl cell, run a separate eval with language `js`.
- Import once per kernel lifetime. `agentToolkit` stays bound in later cells; re-import only after a kernel restart or a `ReferenceError: agentToolkit is not defined`.
- Every call resolves to an envelope, never a throw: `{ ok: true, operation, result, nextActions, warnings? }` or `{ ok: false, operation, error: { code, message }, warnings? }`. `nextActions` are things to do next; `warnings` are facts to know (a fallback the binder took, a driver objective that differs). Read `nextActions` before deciding the next step, and branch on `error.code`, not on the message text.
- Never pass a session id or plan path. The SDK binds `PI_SESSION_ID` and `PI_SESSION_CWD` from the host env on each call; state lives under `.omo/ulw-loop/<session-id>/`. When `PI_SESSION_CWD` is missing (seen after an extension reload restarted the kernel), the binder falls back to the cwd recorded in the `PI_SESSION_FILE` header, then to `process.cwd()`, and every envelope carries a warning naming the fix: `env("PI_SESSION_CWD", "<session cwd>")`. `status().result.binding` shows `{ cwd, cwdSource, sessionId, goalStorePaths }`, so check it after any kernel restart and re-pin the env when `cwdSource` is not `PI_SESSION_CWD`.
- The driver snapshot is filled automatically from this session's goal store. Pass `codexGoalJson` only to override it.

Methods (argument fields are exact):

| Method | Args |
|---|---|
| `help()` | none; `result.operations[]` carries `method` (the camelCase name to call), `args` (field -> type, `?` = optional), `description`, `mutating` — enough to recover every call below after a kernel restart |
| `status()` | none; `result` carries `plan`, `summary`, `nextActions`, `evidenceRoot` (stable plan-level artifact dir), `currentAttemptDir` (moves with the active goal), `binding` (`cwd`, `cwdSource`, `sessionId`, `goalStorePaths`), `driver` (`available`, `status`, `objectiveMatchesPlan`, `objectiveAcknowledged`) |
| `createGoals(args)` | `{ brief, codexGoalMode?, force?, validationBatchesJson? }` |
| `completeGoals(args?)` | `{ retryFailed? }`; acquires the next eligible goal or resumes the in-progress one |
| `criteria(args)` | `{ goalId }` |
| `recordEvidence(args)` | `{ goalId, criterionId, status: "pass" \| "fail" \| "blocked", evidence, notes?, artifacts? }`; every `artifacts` path must exist (resolved against the session cwd, `ULW_LOOP_EVIDENCE_ARTIFACT_MISSING` otherwise) and is stored on the criterion and the ledger entry, repo-relative when inside the cwd |
| `checkpoint(args)` | `{ goalId, status: "complete" \| "failed" \| "blocked", evidence, codexGoalJson?, qualityGateJson? }`, or `{ printTemplate: true, goalId? }` for the quality-gate template |
| `steer(args)` | `{ kind, source: "finding", evidence, rationale, ...kind fields }`; kinds and their fields are in `references/full-workflow.md` |
| `addGoal(args)` | `{ title, objective, successCriteria? }` with `successCriteria: [{ scenario, expectedEvidence, userModel?, essential? }]`; omit it and the three seeded placeholders name the exact `steer({ kind: "revise_criterion", ... })` call that replaces each one |
| `recordReviewBlockers(args)` | `{ goalId, title, objective, evidence, codexGoalJson? }` |

## Non-Negotiables

- Write loop state only through the SDK; it lives under `.omo/ulw-loop/<session-id>/` and is never hand-edited. Mutations are serialized across processes by the session's `.state.lock`, so parallel `recordEvidence` calls from workers are safe.
- Register goals up front, shaped by `references/define-goal.md` (`agentToolkit.createGoals({ brief })`, then `create_goal` from the returned handoff), and mirror every atomic step into the live `todo` checklist: one ultra-granular step per action, exactly one in_progress, transitions marked the instant they happen.
- After any compaction or context loss, re-read brief + goals + ledger FIRST plus `agentToolkit.status()` (re-import the SDK if the kernel restarted; `help()` lists every method with its argument fields), confirm `result.binding.cwdSource` is `PI_SESSION_CWD` and re-pin it with `env("PI_SESSION_CWD", result.binding.cwd)` when it is not, then resume; never re-plan from scratch.
- If `createGoals` answers `ULW_LOOP_PLAN_EXISTS_COMPLETE`, this session's aggregate is already done: start unrelated new work in a fresh session instead of steering or forcing the completed state. Use `force: true` only to intentionally overwrite completed evidence.
- Every success criterion needs observable evidence from a real surface: a channel (terminal/TUI via the xterm.js web terminal, HTTP, browser, computer-use) or, for CLI- or data-shaped criteria, an auxiliary surface (CLI stdout, DB diff, parsed config dump).
- Evidence is bound to the tree it was captured at (`git rev-parse --short "HEAD^{tree}"`); it goes stale only when tracked content changes — a rebase or amend that keeps the tree identical keeps it valid. When the tree differs, re-run at the current HEAD and re-record, never relabel or regenerate. Record only after cleanup receipts exist.
- Delegate code edits, test writes, fixes, and QA execution to right-sized omo-senpi subagents through the native `task` tool or through `workflow` nodes when the phase's lanes carry ordering.
- Use `git-master` for git-tracked edits: inspect recent and touched-path commit history, then commit each verified work unit atomically in the repository's observed language, scope, and message style with only that unit's files staged. Never carry verified units into a later omnibus commit.

## Team mode: decide it, do not default to it

Solo execution with parallel background `task` workers is the default: fan independent units out in one batched spawn, each routed to the `category` (or configured `subagent_type`) that fits it, with scopes cut so no two workers write the same files. A team (`team_create`) adds per-member briefing, shared-state, and relay overhead, so it must be paid for by the work's shape. Decide ONCE, when the plan's work units are known, and record the verdict plus its reason in the notepad.

Stand up a team when BOTH hold:

1. **The units' scopes overlap in a way you cannot cleanly cut.** They touch the same module, contract, or migration, so one unit's discovery changes what another should do. Fire-and-forget workers cannot exchange that mid-flight; teammates can, because the lead relays it.
2. **Running them at the same time actually finishes sooner.** The units are each substantial and none is merely waiting on another's output. Two units where the second only consumes the first's result are a sequence, not a team.

When the units are genuinely independent — separate files, no shared contract — spawn parallel background `task` workers instead and avoid the team coordination overhead entirely. When the work is one cohesive unit, do it yourself. Overlap alone is not enough: near-identical units that would collide on the same lines are faster done in sequence by one worker.

Under team mode, isolate and land per unit:

- **One git worktree per member**, never a shared checkout — concurrent members editing one working tree corrupt each other's diffs and evidence. Give each member its own branch off the base and its own worktree path.
- **Merge per work unit, as each unit is verified.** A member's unit lands when its own evidence is captured and its gates are green; it does not wait for the slowest sibling. Integrate each merged unit back into the base the others branch from, so overlapping members rebase onto real merged work rather than guessing at it.
- **Conflicts are the lead's job.** When two members' units touch the same lines, the lead decides the order they land and tells the later member what changed; members never resolve a sibling's conflict blind.

## Native Senpi Task Contract

Senpi already exposes its real subagent spawn surface through the omo-senpi `task` component. Use it directly. Do not route delegation through external app-server threads or another harness.

| Intent | Native Senpi tool |
| --- | --- |
| Spawn one worker | `task({ prompt, subagent_type | category, run_in_background: true })` |
| Fan out independent workers | `task({ tasks: [{ prompt, subagent_type | category }, ...], run_in_background: true })` |
| Send context or correction | `task_send({ task_id, message })` |
| Inspect one midpoint | `task_output({ task_id, mode: "tail" })` |
| Stop a runaway worker | `task_cancel({ task_id })` |
| Coordinate overlapping work | `team_create`, `task_create`, `task_get`, `task_list`, `task_update`; communicate with `task_send` |

Every worker prompt starts with `TASK:` and names `DELIVERABLE`, `SCOPE`, `VERIFY`, and `STOP WHEN`. Put requested skill names and all required context inside `prompt`; children do not inherit interview context automatically.

## Driver goal lifecycle

The session goal you create with `create_goal` is a DRIVER the loop instructs, never a gate. A checkpoint accepts an optional driver snapshot, records it verbatim, and never rejects on its status or objective; the advice comes back in `nextActions`. The snapshot is filled from this session's goal store automatically, so pass `codexGoal` only to override it. If the driver was completed early, the advice tells you to `create_goal` again with the plan's objective verbatim - a completed goal is replaced, not reused. If the driver is paused or usage/budget limited, the advice tells you to resume it. A different objective is a warning, not a refusal, and it is reported once: the first checkpoint under that driver records the objective in the plan (`acknowledgedDriverObjectives`) and later calls stay quiet; `status().result.driver` shows the relation at any time. `create_goal` is advised only when the goal store really holds no goal.
