LazyCodex installs OmO's discipline-agent surface into Codex. **Hephaestus** remains the autonomous deep-worker voice for end-to-end implementation, while specialist roles support exploration, external research, planning, review, QA, and completion gates.

### What Hephaestus is

Named after the Greek god of the forge. Goal-oriented: you give it objectives, not step-by-step recipes, and it executes them end-to-end. "The Legitimate Craftsman." Methodical, thorough, obsessive — built for deep architectural reasoning, complex debugging, and cross-domain synthesis.

### Installed roles

The current install provides these roles. When Codex exposes `agent_type`, the role is set directly; otherwise the role description is included in the message as a fallback.

| Role | Primary use |
| --- | --- |
| `explorer` | Internal codebase context: structure, call flows, test locations. |
| `librarian` | External docs, library contracts, latest API research. |
| `plan` | Plan drafting and task decomposition. |
| `momus` / `metis` | Missing decisions, edge cases, risk review. |
| `lazycodex-executor` | Executing specific task units from a plan. |
| `lazycodex-code-reviewer` | Post-implementation code quality review. |
| `lazycodex-qa-executor` | Real-execution-based QA. |
| `lazycodex-gate-reviewer` | Pre-completion verification gates. |
| `lazycodex-clone-fidelity-reviewer` | Clone and sync operation fidelity checks. |

### Parent session ownership

Even with multiple roles, completion judgment is never handed wholesale to a sub-agent. The parent Codex session keeps ownership of goals, constraints, and final judgment. Sub-agents are used to read terrain, find gaps, or assist review.

### The operating loop

Hephaestus runs a short, tight loop on every unit of work:

1. **Explore** — map the terrain. Read the code with tools, never speculate. Fire 2-5 parallel explore subagents before writing anything.
2. **Plan** — chart the course. Record files to modify, specific changes, and dependencies via `update_plan`.
3. **Implement** — build with precision. Surgical edits that match codebase style (naming, indentation, imports, error handling) even when a greenfield would read differently.
4. **Verify** — prove it works. LSP diagnostics on changed files, related tests, and build — in parallel where possible.
5. **Manually QA** — drive the artifact through its real surface (HTTP call, tmux, browser), then write the final message.

### Non-goals

- **Never trusts subagent self-reports.** Verification is independent; a child saying "done" does not close the work.
- **Never proposes when you asked for code.** Unless you explicitly want a plan or a brainstorm, it implements.
- **Never speculates about code it has not read.** Exploration is cheap; assumption is expensive.
- **Never leaves work unresolved at end of turn.** Every plan step is reconciled: `completed`, blocked (one-line reason), or removed (one-line reason).

### Delegation and orchestration

The parent Codex session keeps final ownership of goals and verification. For parallel work it can spawn Codex subagent roles and keep the parent session live with brief status updates while children run. Team mode adds a durable named-team surface when coordination is worth the overhead.

### Boulder state

`$start-work` uses `.omo/boulder.json` to persist progress and the Stop-hook continuation to keep plan execution moving. This is the core visible behavior: checkboxes advance, and when all are done it prints **ORCHESTRATION COMPLETE**.

### Where the boulder comes from

OmO's broader orchestration ideas show up in Codex through durable `.omo/boulder.json` progress, Stop-hook continuation, named team state, and reviewer/gate roles. [`$start-work`](./start-work.md) is the main visible path: it advances the plan until every checkbox is done and the final gate is satisfied.

### Reading more

- [ultrawork mode](./ultrawork.md) — the mode that turns the loop into a binding verified run.
- [Hooks & Lifecycle](./hooks-lifecycle.md) — how the Stop-hook re-injects the next turn until the plan is complete.
