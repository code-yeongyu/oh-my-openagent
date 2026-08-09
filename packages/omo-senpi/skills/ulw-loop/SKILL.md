---
name: ulw-loop
description: Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps.
metadata:
  short-description: Goal-like ultrawork loop for systematic decomposition
---

# ulw-loop

Use this skill when the user asks for `ulw-loop`, `ulw`, durable goal execution, evidence-led work, manual QA, or checkpointed long-running delivery.

This skill is intentionally compact. The full workflow lives in `references/full-workflow.md`. Read only the sections needed for the current phase, then execute them exactly.

## Required First Steps

1. Open `references/full-workflow.md`.
2. Read through **Bootstrap** (including its tier triage), **Execution Loop**, the **Manual-QA channels** table, and the **Stop Rules** before running any ULW command or recording evidence.
3. If the task has code edits, tests, QA, or commit work, follow the full workflow's delegation and evidence rules. Tests alone never prove done.

## Non-Negotiables

- Use the ulw-loop CLI state under `.omo/ulw-loop`; do not hand-edit goal state.
- Register goals up front (`omo-agent-toolkit ulw-loop create-goals`, then `create_goal` from the printed handoff) and mirror every atomic step into the live `update_plan` checklist: one ultra-granular step per action, exactly one in_progress, transitions marked the instant they happen.
- After any compaction or context loss, re-read brief + goals + ledger FIRST plus `omo-agent-toolkit ulw-loop status --json`, then resume; never re-plan from scratch.
- If `omo-agent-toolkit ulw-loop create-goals` says the existing aggregate is already complete, start unrelated new work with a fresh `--session-id <new-id>` instead of steering or forcing the completed default state. Use `--force` only to intentionally overwrite completed evidence.
- Every success criterion needs observable evidence from a real surface: a channel (terminal/TUI via the xterm.js web terminal, HTTP, browser, computer-use) or, for CLI- or data-shaped criteria, an auxiliary surface (CLI stdout, DB diff, parsed config dump).
- Evidence is bound to the tree it was captured at (`git rev-parse --short "HEAD^{tree}"`); it goes stale only when tracked content changes — a rebase or amend that keeps the tree identical keeps it valid. When the tree differs, re-run at the current HEAD and re-record, never relabel or regenerate. Record only after cleanup receipts exist.
- Delegate code edits, test writes, fixes, and QA execution to right-sized omo-senpi subagents through the native `task` tool.
- Plan and reviewer agents may run for a long time; spawn them with `run_in_background: true` and keep doing independent root work.
- For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long reading, testing, or review passes, and `BLOCKED: <reason>` only when it cannot progress.
- Track spawned task ids locally. Completion and progress arrive as injected notifications; use `task_output` for at most one midpoint status or transcript check per child, never a polling loop.
- While children run, surface the active subagent count, task ids, and latest `WORKING:` phase.
- If a live child needs context or correction, send it with `task_send`. Fallback only when the child completed without the deliverable, explicitly reported `BLOCKED:`, or is no longer running; then record inconclusive and spawn a smaller native `task` with the missing deliverable.
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
