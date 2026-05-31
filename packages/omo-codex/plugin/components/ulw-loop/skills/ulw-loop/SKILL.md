---
name: ulw-loop
description: Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps.
metadata:
  short-description: Goal-like ultrawork loop for systematic decomposition
---

# ulw-loop

Use this skill when the user asks for `ulw-loop`, `ulw`, durable goal execution, evidence-led work, manual QA, or checkpointed long-running delivery.

This Codex skill is intentionally compact to avoid adding a large operating manual to an already-full conversation. The full workflow lives in `references/full-workflow.md`. Read only the sections needed for the current phase, then execute them exactly.

## Required First Steps

1. Open `references/full-workflow.md`.
2. Read through **Bootstrap**, **Execution Loop**, and the **Manual-QA channels** table before running any ULW command or recording evidence.
3. If the task has code edits, tests, QA, or commit work, follow the full workflow's delegation and evidence rules. Tests alone never prove done.

## Non-Negotiables

- Use the ulw-loop CLI state under `.omo/ulw-loop`; do not hand-edit goal state.
- Every success criterion needs observable evidence from a real channel: tmux, HTTP, browser, or computer-use.
- Record evidence through the CLI only after cleanup receipts are available.
- Delegate code edits, test writes, fixes, and QA execution to right-sized Codex subagents when the workflow requires it.
- Avoid `list_agents` as a status poll in large runs; track spawned names locally and use `wait_agent`, targeted followups, and `close_agent`.

## Codex Tool Mapping

The full workflow may mention OpenCode-style orchestration examples. In Codex, translate them to native tools:

| Workflow intent | Codex tool |
| --- | --- |
| Plan agent | `spawn_agent(agent_type="plan", ...)` |
| Search/read-only worker | `spawn_agent(agent_type="explorer", ...)` |
| Implementation or QA worker | `spawn_agent(agent_type="worker", ...)` |
| Final verification reviewer | `spawn_agent(agent_type="codex-ultrawork-reviewer", ...)` |
| Wait for background result | `wait_agent(...)` |
| Clean up finished worker | `close_agent(...)` |

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`.
