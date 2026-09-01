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
3. Open `references/define-goal.md` and register the run's goal by it. Goal creation is NEVER skipped: shape the objective and every success criterion by that reference before any implementation.
4. If the task has code edits, tests, QA, or commit work, follow the full workflow's delegation and evidence rules. Tests alone never prove done.

## Non-Negotiables

- Use the ulw-loop CLI state under `.omo/ulw-loop`; do not hand-edit goal state.
- Register goals up front, shaped by `references/define-goal.md` (`omo-agent-toolkit ulw-loop create-goals`, then `create_goal` from the printed handoff), and mirror every atomic step into the live `update_plan` checklist: one ultra-granular step per action, exactly one in_progress, transitions marked the instant they happen.
- After any compaction or context loss, re-read brief + goals + ledger FIRST plus `omo-agent-toolkit ulw-loop status --json`, then resume; never re-plan from scratch.
- If `omo-agent-toolkit ulw-loop create-goals` says the existing aggregate is already complete, start unrelated new work with a fresh `--session-id <new-id>` instead of steering or forcing the completed default state. Use `--force` only to intentionally overwrite completed evidence.
- Every success criterion needs observable evidence from a real surface: a channel (terminal/TUI via the xterm.js web terminal, HTTP, browser, computer-use) or, for CLI- or data-shaped criteria, an auxiliary surface (CLI stdout, DB diff, parsed config dump).
- Evidence is bound to the tree it was captured at (`git rev-parse --short "HEAD^{tree}"`); it goes stale only when tracked content changes — a rebase or amend that keeps the tree identical keeps it valid. When the tree differs, re-run at the current HEAD and re-record, never relabel or regenerate. Record only after cleanup receipts exist.
- Delegate code edits, test writes, fixes, and QA execution to right-sized Codex subagents when the workflow requires it.
- Every `spawn_agent` message starts with `TASK:`, then names `DELIVERABLE`, `SCOPE`, and `VERIFY`; put role and specialty instructions inside `message`; use `fork_turns: "none"` (v1: `fork_context: false`) unless full history is truly required.
- Plan and reviewer agents may run for a long time; spawn them in the background and keep doing independent root work. Between `wait_agent` calls, back off — double the timeout up to ~5 minutes — instead of spinning short cycles.
- For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long reading, testing, or review passes, and `BLOCKED: <reason>` only when it cannot progress.
- Track spawned agent names locally. Use `wait_agent` for mailbox signals, not proof of completion. A timeout only means no new mailbox update arrived. Treat a running child as alive.
- While children run, surface the active subagent count, agent names, and latest `WORKING:` phase.
- Fallback only when the child is completed without the deliverable, ack-only after `followup_task`, explicitly `BLOCKED:`, or no longer running. Then record inconclusive and respawn a smaller `fork_turns: "none"` task with the missing deliverable.
- Use `git-master` for git-tracked edits: inspect recent and touched-path commit history, then commit each verified work unit atomically in the repository's observed language, scope, and message style with only that unit's files staged. Never carry verified units into a later omnibus commit.

## Team mode: decide it, do not default to it

Solo execution with parallel background `task` workers is the default. A team (`team_create`) adds per-member briefing, shared-state, and relay overhead, so it must be paid for by the work's shape. Decide ONCE, when the plan's work units are known, and record the verdict plus its reason in the notepad.

Stand up a team when BOTH hold:

1. **The units' scopes overlap in a way you cannot cleanly cut.** They touch the same module, contract, or migration, so one unit's discovery changes what another should do. Fire-and-forget workers cannot exchange that mid-flight; teammates can, because the lead relays it.
2. **Running them at the same time actually finishes sooner.** The units are each substantial and none is merely waiting on another's output. Two units where the second only consumes the first's result are a sequence, not a team.

When the units are genuinely independent — separate files, no shared contract — spawn parallel background `task` workers instead and avoid the team coordination overhead entirely. When the work is one cohesive unit, do it yourself. Overlap alone is not enough: near-identical units that would collide on the same lines are faster done in sequence by one worker.

Under team mode, isolate and land per unit:

- **One git worktree per member**, never a shared checkout — concurrent members editing one working tree corrupt each other's diffs and evidence. Give each member its own branch off the base and its own worktree path.
- **Merge per work unit, as each unit is verified.** A member's unit lands when its own evidence is captured and its gates are green; it does not wait for the slowest sibling. Integrate each merged unit back into the base the others branch from, so overlapping members rebase onto real merged work rather than guessing at it.
- **Conflicts are the lead's job.** When two members' units touch the same lines, the lead decides the order they land and tells the later member what changed; members never resolve a sibling's conflict blind.

## Codex Tool Mapping

Codex exposes ONE subagent surface per session — check your tool list. GPT-5.6 (sol/terra) get the flat MultiAgentV2 tools (primary); GPT-5.5 and gpt-5.6-luna get the namespaced `multi_agent_v1.*` set (fallback row). The workflow's orchestration examples map to:

| Intent | MultiAgentV2 (gpt-5.6 sol/terra) |
| --- | --- |
| Spawn a worker | `spawn_agent({"task_name":"<lower_snake_id>","message":"TASK: act as <role>. ...","fork_turns":"none"})` — `task_name`+`message` required; `fork_turns:"none"` = no parent history; do NOT set `agent_type`/`model`/`reasoning_effort` |
| Re-task an idle worker (wakes it) | `followup_task({"target":"<name>","message":"..."})` |
| Send context without interrupting | `send_message({"target":"<name>","message":"..."})` |
| Wait for a mailbox signal | `wait_agent({"timeout_ms":<ms>})` — any live worker; a timeout only means no new update |
| Enumerate / stop a runaway | `list_agents()` / `interrupt_agent({"target":"<name>"})` — no `close_agent`; finished workers end on their own |

V1 fallback (gpt-5.5, gpt-5.6-luna): `multi_agent_v1.spawn_agent({...,"fork_context":false})`, `multi_agent_v1.send_input` (re-task), `multi_agent_v1.wait_agent({"targets":[...],"timeout_ms":...})`, `multi_agent_v1.close_agent`.

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`.
