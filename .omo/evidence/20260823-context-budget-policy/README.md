# QA Evidence: Preemptive Compaction ContextBudgetPolicy & Hook Lifecycle

## Scope
- `packages/model-core/src/context-budget-policy.ts` (SSOT for 384k active ceiling, 288k warmup, 35k keepRecent)
- `packages/omo-opencode/src/config/schema/context-budget.ts` (Zod schema for `experimental.context_budget`)
- `packages/omo-opencode/src/hooks/preemptive-compaction-trigger.ts` (policy-driven warmup trigger)
- `packages/omo-opencode/src/hooks/preemptive-compaction.ts` (event-driven lifecycle with `session.compacted` cache invalidation)

## Test & QA Results
- **Live Hook QA**: `verdict.json` — 3/3 PASS (sub-threshold, supra-threshold, stale-cache invalidation)
- **Unit Tests**: `focused-bun-test.txt` — 106/106 PASS across core and hook test suites
- **Typecheck**: `tsgo.txt` — 0 errors (`tsgo --noEmit`)
- **Isolation**: Real database untouched (`/tmp/qa-isolated` sandbox)
