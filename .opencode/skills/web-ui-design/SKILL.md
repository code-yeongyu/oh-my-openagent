---
name: web-ui-design
description: "Router/design operating layer for web UI work. Loads and coordinates OpenAgent skills instead of replacing them: planning through /ulw-plan, execution through /start-work, UI build through /frontend, visual checks through /visual-qa, and final review through /review-work."
---

# web-ui-design

`web-ui-design` is an OpenAgent-native router and design operating layer. It does not implement a planner, builder, visual harness, scheduler, hook, bridge, or tool API. Its job is to preserve the OpenAgent execution spine while carrying design brief, persona, taste, accessibility, debt, and handoff context between the OpenAgent skills that already own the work.

Use this skill when a request needs web UI direction, frontend build guidance, design-state continuity, persona-aware review, or design debt handling across an OpenAgent workflow.

## Load Order

Read these references before acting:

1. `references/routing.md` - which OpenAgent skill owns each phase and when to load it.
2. `references/orchestration.md` - shared state, Direct/Auto semantics, safeguards, and role-reference rules.
3. Phase lane docs, loaded before their phase-specific work:
   - `references/lane-a-direction.md` for planning, direction, discovery, personas, taste, and accessibility constraints.
   - `references/lane-b-execution.md` for execution, UI build prompts, frontend handoff, and implementation evidence.
   - `references/lane-c-review.md` for visual QA, design critique, review gates, and objective evidence before judgment.
   - `references/lane-d-memory.md` for design state, debt, handoff, retrospectives, and continuity.

Then route through the existing OpenAgent skills:

| Phase | Owner | Required lane doc | web-ui-design responsibility |
|---|---|---|---|
| Planning | `/ulw-plan` | `references/lane-a-direction.md` | Feed design discovery, personas, taste constraints, accessibility expectations, and debt policy into the Prometheus plan. |
| Execution | `/start-work` | `references/lane-b-execution.md` | Ensure the plan is executed by OpenAgent workers and that design-state context is included in worker prompts. |
| UI build | `/frontend` | `references/lane-b-execution.md` | Require the frontend skill for actual web UI implementation, design-system work, Lighthouse/performance/a11y gates, and React tooling. |
| Visual checks | `/visual-qa` | `references/lane-c-review.md` | Require objective screenshot/TUI evidence and visual-oracle review before design judgment is accepted. |
| Final review | `/review-work` | `references/lane-c-review.md` and `references/lane-d-memory.md` | Make design findings, unresolved debt, and evidence paths explicit inputs to the final implementation review. |

## Operating Contract

- Load or instruct OpenAgent skills; do not duplicate their contracts.
- Store shared design context in `.omo/web-ui-design/state.md` when the active workflow is allowed to write OpenAgent state.
- Treat `.omo/web-ui-design/state.md` as a ledger, not as the source of implementation truth. The plan, changed files, and evidence artifacts remain authoritative for execution.
- Direct and Auto are prompt-only operating modes. They change how assertively OpenAgent proceeds or pauses; they do not install hooks, start background schedulers, or create a separate orchestrator.
- designpowers agents are role references for OpenAgent-native prompts. They are not installed agents, selectable agent types, or a parallel worker system.
- The raw upstream `using-designpowers` skill is not mounted. Any surviving third-party cross-reference to it is inert historical text; this authored router, `references/routing.md`, and `references/orchestration.md` own routing.
- Remaining accessibility debt must be explicit, located, and user-accepted before closeout.

## Guardrails

Do not introduce scripts, hooks, tool APIs, schedulers, fake direct calls, Figma bridge tooling, `figma-bridge`, framesmith, canvas adapters, or `canvas_evaluate`. Those names are prohibited integration paths, not available options.

Do not bypass `/ulw-plan`, `/start-work`, `/frontend`, `/visual-qa`, or `/review-work` when their phase applies. If a task is too small for a full workflow, still follow the ownership boundary: this skill supplies design routing and state language only.

## Completion Rule

A web UI design workflow is complete only when:

- the relevant OpenAgent phase owner has run or been explicitly ruled out for the current scope;
- the current design state, if used, names the brief, personas, taste constraints, accessibility constraints, and accepted debt;
- UI implementation claims cite `/frontend` outputs;
- visual claims cite `/visual-qa` artifacts;
- final sign-off routes through `/review-work` for significant implementation work.
