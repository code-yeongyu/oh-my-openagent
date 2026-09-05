# Final review QA

## What was tested

- `bun test packages/model-core/src/context-budget-policy.test.ts packages/omo-opencode/src/config/schema.test.ts packages/omo-opencode/src/hooks/preemptive-compaction.test.ts`
- `bun x tsgo --noEmit -p packages/model-core/tsconfig.json`
- `bun x tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`

## What was observed

- Focused policy, schema, and hook suite passed: 109 tests, 0 failures before the final tiny-window regression was added; the final policy-only run passed 7 tests, 0 failures.
- Both package typechecks exited successfully with no diagnostics.
- The isolated OpenCode server emitted `server.connected` on `/event`, and the probe cleaned up its isolated sandbox.
- New regressions cover an 8,192-token window, a one-token synthetic window, and an oversized configured reserve; each resolves to a positive active budget instead of zero.

## Why it is enough

The changed production code is confined to policy normalization. Focused tests cover the zero-budget defect and existing compaction integration, package typechecks cover consumers, and the real isolated OpenCode SSE probe confirms the lifecycle event surface still works. Existing evidence in this directory covers a real isolated prompt and unchanged host session count.

## What was omitted

Temporary sandbox paths and verbose server logs were not retained. No credentials or authentication values were recorded.
