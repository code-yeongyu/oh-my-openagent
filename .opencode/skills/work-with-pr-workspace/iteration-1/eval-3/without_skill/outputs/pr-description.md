## Summary

- Split `src/tools/delegate-task/constants.ts` (654 LOC, 6 responsibilities) into 5 focused modules: `default-categories.ts`, `category-descriptions.ts`, `category-prompt-appends.ts`, `plan-agent-prompt.ts`, `plan-agent-identity.ts`
- Extract `CATEGORY_MODEL_REQUIREMENTS` from `src/shared/model-requirements.ts` (311 LOC) into `category-model-requirements.ts`, bringing both files under the 200 LOC limit
- Convert original files to barrel re-exports for 100% backward compatibility (zero consumer changes)

## Motivation

Both files violate the project's 200 LOC modular-code-enforcement rule. `constants.ts` mixed 6 unrelated responsibilities (category configs, prompt templates, plan agent builders, identity utils). `model-requirements.ts` mixed agent and category model requirements.

## Changes

### `src/tools/delegate-task/`
| New File | Responsibility |
|----------|---------------|
| `default-categories.ts` | `DEFAULT_CATEGORIES` record |
| `category-descriptions.ts` | `CATEGORY_DESCRIPTIONS` record |
| `category-prompt-appends.ts` | 8 prompt template constants + `CATEGORY_PROMPT_APPENDS` map |
| `plan-agent-prompt.ts` | Plan agent system prompts + builder functions |
| `plan-agent-identity.ts` | `isPlanAgent`, `isPlanFamily` + name lists |

`constants.ts` is now a barrel re-export file (~25 LOC).

### `src/shared/`
| New File | Responsibility |
|----------|---------------|
| `category-model-requirements.ts` | `CATEGORY_MODEL_REQUIREMENTS` record |

`model-requirements.ts` retains types + `AGENT_MODEL_REQUIREMENTS` and re-exports `CATEGORY_MODEL_REQUIREMENTS`.

## Backward Compatibility

All existing import paths (`from "./constants"`, `from "../../tools/delegate-task/constants"`, `from "../../shared/model-requirements"`) continue to work unchanged. Zero consumer files modified.

## Testing

- `bun run typecheck` passes
- `bun test` passes (existing `tools.test.ts` validates all re-exported symbols)
- `bun run build` succeeds
