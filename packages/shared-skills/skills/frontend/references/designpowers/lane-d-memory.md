# Lane D: Memory, Debt & Handoff

Lane D records the design record around OpenAgent work. It owns `.omo/frontend-design/state.md`, design debt, handoff notes, retrospective notes, and observational taste memory. It has no hooks and no independent automation path. It records and summarizes what happened so the next OpenAgent phase has reliable context.

## Phase Owner

| Capability | Source boundary | owner | Mapping |
|---|---|---|---|
| Track deferred design and accessibility findings | `design-debt-tracker` | `.omo/frontend-design/state.md` plus final `review-work` context | Maintain a register with ID, date, source, severity, issue, affected users, suggested fix, status, and notes. |
| Package design rationale for implementers or reviewers | `design-handoff` | `start-work` and `review-work` context | Record component, interaction, accessibility, content, and rationale notes that workers or reviewers need. |
| Reflect on process after completion | `design-retrospective` | final handoff context | Record what worked, what did not, fix rounds, debt health, and lessons. |
| Maintain observational design memory | Authored concept preserved from excluded raw `design-memory` | `.omo/frontend-design/state.md` and optional personal report context | Store observations descriptively. Do not feed them back as future project constraints. |
| Produce a taste reflection when requested | `taste-report` | user-facing handoff only | Summarize personal-layer observations only when enough evidence exists or the user asks. |
| Route designpowers concepts into frontend | Authored router semantics only; raw `using-designpowers` is excluded | frontend designpowers reference context | Frontend router owns routing and mode language; no raw upstream router path or separate runtime is available. |

Materialized source agents are not primary in this lane. Lane D records outputs from `design-strategist`, `design-lead`, `motion-designer`, `content-writer`, `design-critic`, `accessibility-reviewer`, and `heuristic-evaluator` when those role references contributed context in earlier lanes.

## State File

Lane D's state target is:

```text
.omo/frontend-design/state.md
```

The state file should stay scannable and append-friendly:

- current objective and locked decisions
- source inputs and explicit exclusions
- brief summary, personas, design principles, taste signals, and success criteria when available
- decisions log with rationale
- open questions
- artifact index
- design debt register
- handoff notes
- retrospective notes or links
- evidence index

## Prompt Injection

Append this block when closing a planning, implementation, review, or handoff phase:

```text
Apply Lane D Memory, Debt & Handoff.

Update `.omo/frontend-design/state.md` with:
- decisions made in this phase and the rationale
- any open design questions or owner decisions
- artifact paths and evidence paths
- design debt from deferred Minor or Note findings, including affected users and suggested fixes
- accessibility debt status and explicit user acknowledgement if accepted
- handoff notes for the next owner
- retrospective observations when work is complete

Do not use design memory as a rule source for future work. Record observations as descriptive evidence only.
No hooks or independent automation are available in this lane.
```

## Evidence Requirements

Lane D passes only when the record is inspectable:

- `.omo/frontend-design/state.md` exists before a lane claims durable state.
- Design debt entries include ID, source, severity, affected users, suggested fix, status, and notes.
- Accessibility debt is either resolved or explicitly acknowledged by the user before acceptance.
- Handoff notes cite concrete artifacts, decisions, constraints, and evidence paths.
- Retrospective notes cite the final verification artifacts, unresolved debt, and lessons from fix rounds or user overrides.
- The evidence index points to real files produced by OpenAgent planning, `start-work`, `visual-qa`, or `review-work`.

## Guardrails

- Lane D records state; it does not mutate implementation or run hidden work.
- The design debt register must not capture Critical or Major blockers as ordinary debt. Those require repair, escalation, or explicit blocking status.
- Accepted debt requires a rationale. Accepted accessibility debt requires explicit user acknowledgement.
- Design memory is a mirror, not a steering wheel: it describes how decisions happened and must not silently constrain another project.
- Handoff text must be useful to the next owner, not a narrative transcript.
- No hooks, background schedulers, or extra runtime contracts are part of this lane.

## Pass / Fail Behavior

PASS when state, design debt, handoff, retrospective, and evidence references are current enough for `ulw-plan`, `start-work`, `visual-qa`, or `review-work` to resume without guessing.

FAIL when deferred findings disappear, accessibility debt is accepted without acknowledgement, handoff omits artifact paths, state is stale, retrospective claims lack evidence, or memory is used as prescriptive design input.
