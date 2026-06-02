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
- Every `spawn_agent` message starts with `TASK:`, then names `DELIVERABLE`, `SCOPE`, and `VERIFY`; role selection requires `agent_type`, while `model` + `reasoning_effort` alone creates a default agent, not a reviewer or worker; prefer `fork_turns: "none"` unless full history is truly required.
- Plan and reviewer agents may run for a long time; spawn them in the background, keep doing independent root work, and poll with short wait_agent cycles. Never use a single long blocking wait for them.
- While any child is active, keep the parent visibly alive with brief status updates that include active subagent count, agent names, last heartbeat, and whether the parent is waiting for mailbox updates.
- Avoid `list_agents` as a polling or status tool in large runs; it can replay large agent status and latest-message payloads. Track spawned agent names locally, use `wait_agent` for completion signals, targeted followups only when needed, and `close_agent` after integrating each result.
- Treat `wait_agent` as a mailbox signal, not proof of completion, content, or errors. After two waits with no substantive result, send one targeted followup, then record inconclusive and respawn a smaller `fork_turns: "none"` task if the child stays silent or ack-only.

## Codex Tool Mapping

The full workflow may mention OpenCode-style orchestration examples. In Codex, translate them to native tools:

| Workflow intent | Codex tool |
| --- | --- |
| Plan agent | `spawn_agent(agent_type="plan", fork_turns="none", ...)` |
| Search/read-only worker | `spawn_agent(agent_type="explorer", fork_turns="none", ...)` |
| Implementation or QA worker | `spawn_agent(agent_type="worker", fork_turns="none", ...)` |
| Final verification reviewer | `spawn_agent(agent_type="codex-ultrawork-reviewer", fork_turns="none", ...)` |
| Wait for background result | `wait_agent(...)` |
| Clean up finished worker | `close_agent(...)` |

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`.
