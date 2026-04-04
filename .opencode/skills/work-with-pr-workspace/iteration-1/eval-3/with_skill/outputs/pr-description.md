# PR Title

```
refactor(delegate-task): split constants.ts into focused modules
```

# PR Body

## Summary

- Split the 654-line `src/tools/delegate-task/constants.ts` into 4 single-responsibility modules: `default-categories.ts`, `category-prompt-appends.ts`, `plan-agent-prompt.ts`, `plan-agent-names.ts`
- `constants.ts` becomes a pure re-export barrel, preserving all existing import paths (`from "./constants"` and `from "./delegate-task"`)
- Zero import changes across the codebase (6 external + 7 internal consumers verified)

## Motivation

`constants.ts` at 654 lines violates the project's 200 LOC soft limit (`modular-code-enforcement.md` rule) and bundles 4 unrelated responsibilities: category model configs, category prompt text, plan agent prompts, and plan agent name utilities.

## Changes

| New File | Responsibility | LOC |
|----------|---------------|-----|
| `default-categories.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_DESCRIPTIONS` | ~25 |
| `category-prompt-appends.ts` | 8 `*_PROMPT_APPEND` constants + `CATEGORY_PROMPT_APPENDS` record | ~300 (prompt-exempt) |
| `plan-agent-prompt.ts` | Plan system prompt constants + `buildPlanAgentSystemPrepend()` | ~250 (prompt-exempt) |
| `plan-agent-names.ts` | `PLAN_AGENT_NAMES`, `isPlanAgent`, `PLAN_FAMILY_NAMES`, `isPlanFamily` | ~30 |
| `constants.ts` (updated) | 4-line re-export barrel | 4 |

## Backward Compatibility

All 13 consumers continue importing from `"./constants"` or `"../tools/delegate-task/constants"` with zero changes. The re-export chain: new modules -> `constants.ts` -> `index.ts` -> external consumers.

## Note on CATEGORY_MODEL_REQUIREMENTS

`CATEGORY_MODEL_REQUIREMENTS` already lives in `src/shared/model-requirements.ts`. No move needed. The AGENTS.md reference to it being in `constants.ts` is outdated.

## Testing

- `bun run typecheck` passes
- `bun test src/tools/delegate-task/` passes (all existing tests untouched)
- `bun run build` succeeds
