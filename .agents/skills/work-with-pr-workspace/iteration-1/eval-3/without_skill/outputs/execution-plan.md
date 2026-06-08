# Execution Plan: Refactor constants.ts

## Context

`src/tools/delegate-task/constants.ts` is **654 lines** with 6 distinct responsibilities. Violates the 200 LOC modular-code-enforcement rule. `CATEGORY_MODEL_REQUIREMENTS` is actually in `src/shared/model-requirements.ts` (311 lines, also violating 200 LOC), not in `constants.ts`.

## Pre-Flight Analysis

### Current `constants.ts` responsibilities:
1. **Category prompt appends** (8 template strings, ~274 LOC prompt text)
2. **DEFAULT_CATEGORIES** (Record<string, CategoryConfig>, ~10 LOC)
3. **CATEGORY_PROMPT_APPENDS** (map of category->prompt, ~10 LOC)
4. **CATEGORY_DESCRIPTIONS** (map of category->description, ~10 LOC)
5. **Plan agent prompts** (2 template strings + 4 builder functions, ~250 LOC prompt text)
6. **Plan agent identity utils** (`isPlanAgent`, `isPlanFamily`, ~30 LOC)

### Current `model-requirements.ts` responsibilities:
1. Types (`FallbackEntry`, `ModelRequirement`)
2. `AGENT_MODEL_REQUIREMENTS` (~146 LOC)
3. `CATEGORY_MODEL_REQUIREMENTS` (~148 LOC)

### Import dependency map for `constants.ts`:

**Internal consumers (within delegate-task/):**
| File | Imports |
|------|---------|
| `categories.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_PROMPT_APPENDS` |
| `tools.ts` | `CATEGORY_DESCRIPTIONS` |
| `tools.test.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_PROMPT_APPENDS`, `CATEGORY_DESCRIPTIONS`, `isPlanAgent`, `PLAN_AGENT_NAMES`, `isPlanFamily`, `PLAN_FAMILY_NAMES` |
| `prompt-builder.ts` | `buildPlanAgentSystemPrepend`, `isPlanAgent` |
| `subagent-resolver.ts` | `isPlanFamily` |
| `sync-continuation.ts` | `isPlanFamily` |
| `sync-prompt-sender.ts` | `isPlanFamily` |
| `index.ts` | `export * from "./constants"` (barrel) |

**External consumers (import from `"../../tools/delegate-task/constants"`):**
| File | Imports |
|------|---------|
| `agents/atlas/prompt-section-builder.ts` | `CATEGORY_DESCRIPTIONS` |
| `agents/builtin-agents.ts` | `CATEGORY_DESCRIPTIONS` |
| `plugin/available-categories.ts` | `CATEGORY_DESCRIPTIONS` |
| `plugin-handlers/category-config-resolver.ts` | `DEFAULT_CATEGORIES` |
| `shared/merge-categories.ts` | `DEFAULT_CATEGORIES` |
| `shared/merge-categories.test.ts` | `DEFAULT_CATEGORIES` |

**External consumers of `CATEGORY_MODEL_REQUIREMENTS`:**
| File | Import path |
|------|-------------|
| `tools/delegate-task/categories.ts` | `../../shared/model-requirements` |

## Step-by-Step Execution

### Step 1: Create branch
```bash
git checkout -b refactor/split-category-constants dev
```

### Step 2: Split `constants.ts` into 5 focused files

#### 2a. Create `default-categories.ts`
- Move `DEFAULT_CATEGORIES` record
- Import `CategoryConfig` type from config schema
- ~15 LOC

#### 2b. Create `category-descriptions.ts`
- Move `CATEGORY_DESCRIPTIONS` record
- No dependencies
- ~12 LOC

#### 2c. Create `category-prompt-appends.ts`
- Move all 8 `*_CATEGORY_PROMPT_APPEND` template string constants
- Move `CATEGORY_PROMPT_APPENDS` mapping record
- No dependencies (all self-contained template strings)
- ~280 LOC (mostly prompt text, exempt from 200 LOC per modular-code-enforcement)

#### 2d. Create `plan-agent-prompt.ts`
- Move `PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS`
- Move `PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS`
- Move `renderPlanAgentCategoryRows()`, `renderPlanAgentSkillRows()`
- Move `buildPlanAgentSkillsSection()`, `buildPlanAgentSystemPrepend()`
- Imports: `AvailableCategory`, `AvailableSkill` from agents, `truncateDescription` from shared
- ~270 LOC (mostly prompt text, exempt)

#### 2e. Create `plan-agent-identity.ts`
- Move `PLAN_AGENT_NAMES`, `isPlanAgent()`
- Move `PLAN_FAMILY_NAMES`, `isPlanFamily()`
- No dependencies
- ~35 LOC

### Step 3: Convert `constants.ts` to barrel re-export file
Replace entire contents with re-exports from the 5 new files. This maintains 100% backward compatibility for all existing importers.

### Step 4: Split `model-requirements.ts`

#### 4a. Create `src/shared/category-model-requirements.ts`
- Move `CATEGORY_MODEL_REQUIREMENTS` record
- Import `ModelRequirement` type from `./model-requirements`
- ~150 LOC

#### 4b. Update `model-requirements.ts`
- Remove `CATEGORY_MODEL_REQUIREMENTS`
- Add re-export: `export { CATEGORY_MODEL_REQUIREMENTS } from "./category-model-requirements"`
- Keep types (`FallbackEntry`, `ModelRequirement`) and `AGENT_MODEL_REQUIREMENTS`
- ~165 LOC (now under 200)

### Step 5: Verify no import breakage
- Run `bun run typecheck` to confirm all imports resolve
- Run `bun test` to confirm no behavioral regressions
- Run `bun run build` to confirm build succeeds

### Step 6: Verify LSP diagnostics clean
- Check `lsp_diagnostics` on all new and modified files

### Step 7: Commit and create PR
- Single atomic commit: `refactor: split delegate-task constants and category model requirements into focused modules`
- Create PR with description

## Files Modified

| File | Action |
|------|--------|
| `src/tools/delegate-task/constants.ts` | Rewrite as barrel re-export |
| `src/tools/delegate-task/default-categories.ts` | **NEW** |
| `src/tools/delegate-task/category-descriptions.ts` | **NEW** |
| `src/tools/delegate-task/category-prompt-appends.ts` | **NEW** |
| `src/tools/delegate-task/plan-agent-prompt.ts` | **NEW** |
| `src/tools/delegate-task/plan-agent-identity.ts` | **NEW** |
| `src/shared/model-requirements.ts` | Remove CATEGORY_MODEL_REQUIREMENTS, add re-export |
| `src/shared/category-model-requirements.ts` | **NEW** |

**Zero changes to any consumer files.** All existing imports work via barrel re-exports.
