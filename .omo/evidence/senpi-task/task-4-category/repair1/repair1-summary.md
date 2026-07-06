# Todo 4 Category Resolution Repair 1 Evidence

## WHAT WAS TESTED

- RED regression suite: `bun test packages/senpi-task/src/category`
  - Artifact: `red-category-tests.log`
  - Exit: `red-category-tests.exit` = 1
  - Scenarios: hardcoded `quick` fallback to `anthropic/claude-haiku-4-5`, hardcoded `ultrabrain` fallback to `google/gemini-3.1-pro`, system default fallback, `tools` carry-through, malformed registry entry, prototype-shaped category names, custom description preservation.
- Focused GREEN suite: `bun test packages/senpi-task/src/category`
  - Artifact: `category-tests.log`
  - Exit: `category-tests.exit` = 0
- Package suite: `bun test packages/senpi-task --bail`
  - Artifact: `senpi-task-tests.log`
  - Exit: `senpi-task-tests.exit` = 0
- Type gate: `bun run typecheck`
  - Artifact: `typecheck.log`
  - Exit: `typecheck.exit` = 0
- Manual data-surface QA: `bun run packages/senpi-task/scripts/manual-category-qa.ts`
  - Artifact: `manual-category-qa.log`
  - Exit: `manual-category-qa.exit` = 0
  - Scenarios: happy `ultrabrain`, disabled overlay, selected unavailable model, hardcoded `quick` fallback-chain success, system default success, malformed registry typed failure, prototype-name typed failure.
- Runtime OpenCode import guard: scoped `rg` over Todo 4 source.
  - Artifact: `guard-no-omo-opencode-imports.log`
  - Exit: `guard-no-omo-opencode-imports.exit` = 0
- Local 7-step order guard: `resolveModelForDelegateTask` must be present; local model-order helpers/prose must be absent.
  - Artifact: `guard-no-local-model-order.log`
  - Exit: `guard-no-local-model-order.exit` = 0
- No-excuse TypeScript guard: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts`
  - Artifact: `no-excuse-ts-guard.log`
  - Exit: `no-excuse-ts-guard.exit` = 0
- Changed-source LOC check.
  - Artifact: `loc-check.log`
  - Exit: `loc-check.exit` = 0

## WHAT WAS OBSERVED

- RED output failed for the intended pre-fix blockers:
  - hardcoded fallback-chain regressions returned `model_unavailable`;
  - `tools` was `undefined`;
  - malformed registry `[null]` threw on `model.provider`;
  - prototype-shaped category names returned `model_unavailable`;
  - custom description was dropped.
- GREEN focused suite passed 12 tests with 48 assertions.
- Manual QA output includes:
  - `hardcodedFallback.kind: "resolved"` with `anthropic/claude-haiku-4-5`;
  - `systemDefault.kind: "resolved"` with `local/system-default`;
  - `malformed.kind: "model_unavailable"` and `availableModels: []`;
  - `prototypeName.kind: "not_found"`.
- Guard output confirms no runtime `omo-opencode` imports and no local model-order helper calls in Todo 4 category source.
- No-excuse guard reported no violations in 12 files.
- LOC check shows all changed source files are below 250 pure LOC.

## WHY IT IS ENOUGH

The RED/GREEN pair directly covers each Gate B blocker with behavior tests rather than static import overfit. The resolver still delegates model ordering to `delegate-core`; Senpi owns only the category fallback data table and adapter mapping. Manual QA drives the exported resolver through the same in-memory registry surface later task spawning will use, including success and typed failure cases. Typecheck, package tests, no-excuse, import guards, local-order guard, and LOC checks cover integration and maintainability risk.

## WHAT WAS OMITTED

- No OpenCode or Codex harness QA was run because this repair touched only `packages/senpi-task` category adapter code and evidence.
- No real user config, network, filesystem outside this worktree, or secret-bearing logs were used.
- The fallback-chain table is locally mirrored because adding `@oh-my-opencode/model-core` to `packages/senpi-task/package.json` is outside the allowed edit scope for this repair.
