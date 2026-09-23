# Plan: Issue #6862 - Multi-file prompt_append (string | string[])

Branch: issue/6862-multifile-prompt-append (worktree /home/viprix/projects/oom-wt-6862, base dev @8833800ae)

## Salvage decision

Crashed agent left 7 modified TEST files (failing-first TDD, no implementation):
config-schema.test.ts (omo-config-core), agent-identity.test.ts, resolve-file-uri.test.ts,
schema.test.ts + schema/agent-overrides.test.ts + tools/delegate-task/tools.test.ts (omo-opencode),
resolve-category.test.ts (senpi-task). SALVAGE all 7; implement the missing production code.
Dirty submodules under packages/shared-skills/upstreams/* are pre-existing; NEVER stage.

## Design

- Schema layer: `prompt_append: z.union([z.string(), z.array(z.string())]).optional()` in
  omo-config-core category.ts AND omo-opencode categories.ts (drift guard pins parity) AND
  agent-overrides.ts. TS type `AgentOverrideConfig.prompt_append: string | string[]`.
- Resolution layer: new `resolvePromptAppendSources(input: string | string[], configDir?): string | undefined`
  in resolve-file-uri.ts. string -> existing resolvePromptAppend. array -> per-entry resolvePromptAppend,
  join with "\n\n" in array order (deterministic array-index ordering per issue), empty array -> undefined.
  Per-entry resolution gives mixed inline/file:// entries and per-entry ~ expansion for free.
- Concatenation sites normalize arrays to "\n\n"-joined strings at their boundary so downstream
  stays string-typed.

## Edits (each verified by the salvaged tests)

1. omo-config-core/src/schema/category.ts - union type.
2. omo-opencode/src/config/schema/categories.ts - union type (parity).
3. omo-opencode/src/config/schema/agent-overrides.ts - union type.
4. omo-opencode/src/agents/types.ts - AgentOverrideConfig.prompt_append union.
5. omo-opencode/src/agents/builtin-agents/resolve-file-uri.ts - add resolvePromptAppendSources;
   export it; test file import updated.
6. omo-opencode/src/agents/builtin-agents/agent-overrides.ts - applyCategoryOverride +
   mergeAgentConfig route through resolvePromptAppendSources (empty-array safe).
7. omo-opencode/src/plugin-handlers/prometheus-agent-config-builder.ts - local prompt_append type
   union + sources resolver in the [prompt, prompt_append] loop.
8. omo-opencode/src/plugin-handlers/agent-config-assembly.ts - cast annotation union.
9. omo-opencode/src/agents/sisyphus-junior/agent.ts - pre-resolve override?.prompt_append via
   sources resolver before buildSisyphusJuniorPrompt (9 model-variant files untouched).
10. omo-opencode/src/tools/delegate-task/categories.ts - normalize userConfig.prompt_append before
    composing promptAppend (delegate path treats entries as literal text today; unchanged).
11. omo-opencode/src/tools/delegate-task/category-resolver.ts - resolveCategoryPromptAppendForModel
    accepts string | string[], normalizes.
12. packages/senpi-task/src/category/resolver.ts - promptAppendForCategory normalizes array.
13. Regenerate assets: bun run build:schema + bun run build:omo-schema (freshness guards).
14. Docs: docs/reference/configuration.md documents array form + ordering guarantee.

## Verification

- bun test on the 7 salvaged test files + senpi-task category suite + omo-config-core suite.
- tests/omo-config-category-drift.test.ts + tests/omo-schema-freshness.test.ts green.
- bun run typecheck.
- Evidence dir .omo/evidence/20260824-6862-multifile-append/ (WHAT TESTED/OBSERVED/WHY ENOUGH/OMITTED).
- Conventional commit; push fork; PR base dev, head AceRothstein71:issue/6862-multifile-prompt-append.

## Constraints honored

No as any/@ts-ignore/@ts-expect-error; no weakened tests; no submodule staging; no force-push;
string form backward compatible everywhere.
