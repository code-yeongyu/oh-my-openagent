## Title

feat(omo): task-first subagents (batch barrier) + memo anchor + ULW toggle (hide legacy delegate_task)

## Summary (what this PR does)

This PR reworks OmO’s sub-agent behavior to align with **OpenCode’s native Task semantics**, while making the experience **more stable, more inspectable in the TUI, and cheaper in tokens**:

* Uses **native `task`** for sub-agents so the TUI can show **real, openable child sessions** (the “Momus/Metis style” UX).
* Adds **`batch(task...)` as a barrier** for parallel research: spawn N tasks in parallel, then **wait for all** results before the parent continues.
* Enforces **flat sub-agents** (no nesting / no nuclear-fission spawning): sub-sessions are created with `call_omo_agent=false`, and spawning tools are denied.
* Keeps `delegate_task` implementation for compatibility, but **removes it from prompts** and **denies it by default**, so the model naturally stops using it.
* Adds a durable **external memory (“memo anchor”)**: `.sisyphus/memo.md`, built to survive repeated compactions.
* Replaces “type `ulw` in chat” with a **global ULW toggle** (`/omo ulw on|off|toggle`) + cleaner injection.
* Rewrites the **three main agent prompts** (Sisyphus / Prometheus / Orchestrator-Sisyphus) to be shorter, less format-heavy, and more tool-accurate.

### User-facing highlights (why you’ll feel the difference)

These are the same changes as above, phrased for day-to-day use:

1. **Durable external memory:** the memo mechanism helps the AI keep your earliest constraints even after **dozens of compactions** (it re-reads `.sisyphus/memo.md` to re-anchor the mission).
2. **A new sub-agent system with a better UI:** sub-agents are **native Task sessions** you can **click into and inspect** in the TUI.
3. **Three main prompts fully rewritten:** avoids rigid formatting frameworks that cause **over-alignment** and reduce thinking quality; cuts **system prompt bloat dramatically** (measured raw-byte reductions below), reducing drift and tool misuse.
4. **Stops large-task chaos:** prevents the “partial info arrives → parent replans → more partial info arrives → parent replans again” loop that made big tasks feel unstable.
5. **Multi-turn sub-agent follow-ups:** the parent can ask follow-up questions to the *same* sub-agent session (`task(session_id=...)`), and that sub-agent retains its own context window.
6. **Meaningfully lower token usage:** smaller system prompts + fewer re-plans + barriered aggregation = fewer wasted tokens.
7. **No more repeatedly typing `ulw`:** ULW becomes a proper **toggle and default**, not a keyword ritual.
8. **Compaction continuity improvements:** new handling ensures the workflow **correctly reconnects after compaction** (including auto-compaction reinjection of the latest user message).
9. **Clearer responsibilities across the three main agents:** Sisyphus is execution-only (no subagents), Prometheus is planning-only (forced read-only), orchestrator-sisyphus can both orchestrate and implement—**clean separation of power and constraints**.

## Motivation / problem statement

OmO previously relied heavily on a custom background/delegate pattern to run sub-agents “in the background”.
In complex tasks, this led to:

* **Recursive spawning** (sub-agents can spawn sub-sub-agents) → “nuclear fission” task storms.
* **Non-blocking parent agent**: the parent continues reasoning and planning while partial sub-agent results arrive at random times.
* **Out-of-order injections** and repeated re-planning: the parent makes decisions with incomplete context, then revises when new results arrive.
* **Worse UX**: background tasks are not first-class sessions; users cannot easily open/inspect the sub-agent conversation like native Task sessions.

OpenCode already has a strong native pattern (Momus/Metis) based on `task`:
blocking semantics + visible sub-sessions. This PR generalizes that pattern for OmO.

**In other words:** this PR is not just “a different orchestration API”—it’s a stability + UX + cost fix. The parent agent now waits for complete sub-results (especially in parallel research), so it doesn’t thrash, and you can open each child session to see what it did.

## Key design changes

### 1) Task-first orchestration (native UI + blocking semantics)

* Main orchestrators (see “Agent responsibilities”) are instructed to use:

  * `task` for a single sub-agent
  * `batch(tool_calls=[{tool:"task",...}, ...])` for parallel research
* Because the tool is OpenCode-native, users get:

  * a child session per sub-agent
  * the ability to open/watch the sub-agent session in the TUI
  * parent agent being blocked while the tool call is running (no premature planning)

This directly addresses the “big tasks get messy” failure mode: the parent no longer advances on incomplete evidence, which also reduces rework and token waste.

### 2) Batch as a barrier (parallel, deterministic aggregation)

We treat `batch` as a concurrency primitive for Task calls:

* `batch` is allowed **only** for `task` tool calls (max 10 entries).
* Parent agent continues **only after** batch returns (barrier).
* Output collection is deterministic: parent gets a single tool result containing all sub-results, instead of random-time injections.

Practically: you can kick off 3–10 research sub-agents in parallel, and the parent receives one aggregated payload, once, in-order.

### 3) Flat sub-agents (no nesting)

Child sessions are created with:

* `call_omo_agent=false`
* spawning tools denied (`task` / `delegate_task`), to prevent sub-sub-agent spawning

This is enforced for both:

* the legacy background-agent path (still present for compatibility), and
* any compatibility paths that create child sessions.

This is the core “no nuclear fission” guarantee: sub-agents can research and answer, but cannot spawn more agents.

### 4) Multi-turn sub-agent follow-ups

Native Task sessions are real sessions: a parent can ask follow-ups by re-invoking `task(session_id=...)`.

* The sub-agent retains its own context window.
* The parent can continue a sub-agent conversation to refine the result without creating a new sub-agent from scratch.

This turns sub-agents from “one-shot tools” into “inspectable, iteratable mini-sessions,” which is both more powerful and more transparent for users.

## Prompt rewrites (3 main agents)

This PR rewrites:

* `orchestrator-sisyphus`
* `Prometheus (Planner)`
* `Sisyphus`

Goals:

* Remove rigid “format checklists” that cause over-alignment and reduce reasoning quality.
* Make tool usage instructions **accurate** (prevent hallucinated tool names / invalid params).
* Reduce system prompt bloat and attention drift.

Measured prompt size reductions vs upstream `origin/dev` (beta.11 era), raw bytes:

* `src/agents/orchestrator-sisyphus.ts`: **57,732 → 21,683** (~62% smaller)
* `src/agents/prometheus-prompt.ts`: **40,932 → 14,145** (~65% smaller)
* `src/agents/sisyphus.ts`: **21,866 → 10,196** (~53% smaller)

Expected impact:

* Lower steady-state token usage per turn (smaller system prompts).
* Fewer “stormy” outputs (parent doesn’t plan on partial info).
* Reduced drift/mismatch between “what prompts claim tools can do” vs “what tools actually accept,” improving correctness and cutting retries.

## Memo anchor (durable external memory)

When enabled, OmO uses a single durable anchor file:

* `.sisyphus/memo.md`

Design intent:

* After many rounds of compaction, the agent still remembers the earliest critical constraints.
* The memo is incrementally updated (no blind reset), and acts as “state serialization” for continuity.

This is explicitly meant to handle the real-world scenario where users do long, multi-phase work: even if the chat compacts repeatedly, the memo persists the core requirements and “why we’re doing this.”

Compaction handling:

* During compaction, the continuation prompt is instructed to avoid duplicating memo content.
* After compaction:

  * the next turn is guided to re-read `.sisyphus/memo.md`
  * for **auto** compactions, the latest user message is re-injected (visible) to keep continuity

## ULW changes (no more keyword trigger)

Previous behavior: users had to type `ulw`/`ultrawork` in chat to trigger injection (and it was noisy).

New behavior:

* ULW is controlled via a global toggle (`/omo ulw on|off|toggle`).
* Keyword trigger is disabled.
* ULW injection is cleaner and aligned to the new sub-agent system.
* When ULW is enabled, the assistant’s first line must be:

  * `ULW MODE ENABLED`
    so users can confirm the mode is active.

This keeps ULW as an intentional “mode,” not something that accidentally triggers or requires repeated manual incantations.

## Agent responsibilities (clear separation of concerns)

The three “main” agents have explicit roles:

1. **Sisyphus** (executor)

* Implements changes directly.
* Cannot spawn sub-agents (no `task` / `batch` / `delegate_task`).

2. **Prometheus (Planner)** (planning-only)

* Produces plans and orchestration guidance.
* Is enforced to be read-only (writes only to `.sisyphus/*.md`).
* Uses `task`/`batch` to consult Metis/Momus and gather evidence before planning.

3. **orchestrator-sisyphus** (orchestrator + implementer)

* Can orchestrate sub-agents (`task` / `batch`) and implement code changes.
* Intended for “start-work” workflows that turn a plan into actual implementation.

This clearer separation is a major contributor to stability: it prevents “everyone can do everything,” which is where tool misuse and uncontrolled spawning tend to originate.

## Background tasks / legacy path changes

This PR keeps the background-task system for compatibility, but tightens it:

* Concurrency keys now prefer `input.model ?? input.parentModel` (`providerID/modelID`) so:

  * `background_task.providerConcurrency` and `background_task.modelConcurrency` actually apply.
* Limits are clamped at runtime (max **10**).
* `0` disables legacy background tasks for the matching scope.
* Cancellation keys match acquisition keys (avoid “can’t cancel queued task” edge cases).

The intent is: legacy remains available for advanced setups, but the default experience is firmly “task-first, visible, and controlled.”

## How to use (for users)

### `/omo` toggles

Type these into chat:

* `/omo status`
* `/omo memo on|off|toggle`
* `/omo ulw on|off|toggle`

Help:

* `/omo-help` (builtin command template)

### Config defaults (oh-my-opencode.json)

You can set default states globally and restrict injection to specific agents:

```jsonc
{
  "memo": {
    "enabled": true,
    "agents": ["Sisyphus", "Prometheus (Planner)", "orchestrator-sisyphus"]
  },
  "ulw": {
    "enabled": true,
    "agents": ["Prometheus (Planner)", "orchestrator-sisyphus"]
  },
  "background_task": {
    "defaultConcurrency": 5,
    "providerConcurrency": { "anthropic": 3, "openai": 5, "google": 10 },
    "modelConcurrency": { "anthropic/claude-opus-4-5": 2 }
  }
}
```

Notes:

* ULW is intentionally not enabled for Sisyphus by default (Sisyphus cannot spawn sub-agents, while ULW emphasizes task-first orchestration).
* If `memo.enabled=true` and `.sisyphus/memo.md` does not exist, OmO auto-creates it.
* `background_task.*Concurrency` values are clamped (max 10). `0` disables the legacy path.

## Reviewer guide (where to look)

* Agent prompts:

  * `src/agents/orchestrator-sisyphus.ts`
  * `src/agents/prometheus-prompt.ts`
  * `src/agents/sisyphus.ts`
  * `src/agents/ulw-contract.ts`
  * `src/agents/memo-contract.ts`
* `/omo` toggle + injection + compaction recovery:

  * `src/index.ts`
  * `src/features/omo-command/*`
  * `src/features/memo-anchor/*`
  * `src/features/ulw/*`
  * `src/features/omo-onboarding/*`
* Legacy background tasks tightening:

  * `src/features/background-agent/*`

## Tests / verification

* `bun run typecheck`
* `bun test`
* `bun run build`

## Compatibility notes

* `delegate_task` is preserved but denied by default and removed from main agent prompts.

  * This avoids breaking advanced setups immediately, while steering the model toward the new task-first path.

## Potential follow-ups (optional)

* Further tighten `batch` visibility for subagents (depending on OpenCode tool permission semantics).
* Additional UX polish for onboarding and toggles (based on user feedback).
