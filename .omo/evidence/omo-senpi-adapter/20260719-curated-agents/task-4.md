# Task 4 evidence - agent-aware resolution and persistence

## What was tested

- `resolveAgent` covers fallback resolution, direct model precedence, ordered model alternatives, disabled and unknown agents, unavailable registries, explicit-model persona resolution, tool-rule filtering, and `resolved_model.source: "agent"`.
- A fresh `RecordStore` instance re-reads an agent-sourced record from disk through `parseTaskRecord`.
- Unknown-target rendering carries both active agent and category rosters.
- Curated names are rejected by team-member validation.
- Registry parsing was extracted to `agent-model-registry.ts`, leaving `resolve-agent.ts` at 176 lines.

## What was observed

- The focused `resolve-agent.test.ts` run completed with 7 pass and 0 fail; the full package gate covered the record-store, task execution, and member-validator cases.
- Mutation proof: temporarily removing `case "agent"` from the record parser made the fresh-store round-trip fail; restoring it returned the suite to green.

## Why it is enough

The tests cross the model, persona, tool-policy, persistence, error-reporting, and team-eligibility boundaries that consume agent resolution.

## What was omitted

No category lookup occurs inside `resolveAgent`; planner compatibility remains task 7.
