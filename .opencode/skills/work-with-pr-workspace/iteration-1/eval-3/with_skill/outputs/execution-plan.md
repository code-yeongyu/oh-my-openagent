# Execution Plan: Split delegate-task/constants.ts

## Phase 0: Setup

```bash
git fetch origin dev
git worktree add ../omo-wt/refactor-delegate-task-constants origin/dev -b refactor/split-delegate-task-constants
cd ../omo-wt/refactor-delegate-task-constants
```

## Phase 1: Implement

### Analysis

`src/tools/delegate-task/constants.ts` is 654 lines with 4 distinct responsibilities:

1. **Category defaults** (lines 285-316): `DEFAULT_CATEGORIES`, `CATEGORY_DESCRIPTIONS`
2. **Category prompt appends** (lines 8-305): 8 `*_CATEGORY_PROMPT_APPEND` string constants + `CATEGORY_PROMPT_APPENDS` record
3. **Plan agent prompts** (lines 318-620): `PLAN_AGENT_SYSTEM_PREPEND_*`, builder functions
4. **Plan agent names** (lines 626-654): `PLAN_AGENT_NAMES`, `isPlanAgent`, `PLAN_FAMILY_NAMES`, `isPlanFamily`

Note: `CATEGORY_MODEL_REQUIREMENTS` is already in `src/shared/model-requirements.ts`. No move needed.

### New Files

| File | Responsibility | ~LOC |
|------|---------------|------|
| `default-categories.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_DESCRIPTIONS` | ~40 |
| `category-prompt-appends.ts` | 8 prompt append constants + `CATEGORY_PROMPT_APPENDS` record | ~300 (exempt: prompt text) |
| `plan-agent-prompt.ts` | Plan agent system prompt constants + builder functions | ~250 (exempt: prompt text) |
| `plan-agent-names.ts` | `PLAN_AGENT_NAMES`, `isPlanAgent`, `PLAN_FAMILY_NAMES`, `isPlanFamily` | ~30 |
| `constants.ts` (updated) | Re-exports from all 4 files (backward compat) | ~5 |

### Commit 1: Extract category defaults and prompt appends

**Files changed**: 3 new + 1 modified
- Create `src/tools/delegate-task/default-categories.ts`
- Create `src/tools/delegate-task/category-prompt-appends.ts`
- Modify `src/tools/delegate-task/constants.ts` (remove extracted code, add re-exports)

### Commit 2: Extract plan agent prompt and names

**Files changed**: 2 new + 1 modified
- Create `src/tools/delegate-task/plan-agent-prompt.ts`
- Create `src/tools/delegate-task/plan-agent-names.ts`
- Modify `src/tools/delegate-task/constants.ts` (final: re-exports only)

### Local Validation

```bash
bun run typecheck
bun test src/tools/delegate-task/
bun run build
```

## Phase 2: PR Creation

```bash
git push -u origin refactor/split-delegate-task-constants
gh pr create --base dev --title "refactor(delegate-task): split constants.ts into focused modules" --body-file /tmp/pr-body.md
```

## Phase 3: Verify Loop

- **Gate A**: `gh pr checks --watch`
- **Gate B**: `/review-work` (5-agent review)
- **Gate C**: Wait for cubic-dev-ai[bot] "No issues found"

## Phase 4: Merge

```bash
gh pr merge --squash --delete-branch
git worktree remove ../omo-wt/refactor-delegate-task-constants
```

## Import Update Strategy

No import updates needed. Backward compatibility preserved through:
1. `constants.ts` re-exports everything from the 4 new files
2. `index.ts` already does `export * from "./constants"` (unchanged)
3. All external consumers import from `"../tools/delegate-task/constants"` or `"./constants"` -- both still work

### External Import Map (Verified -- NO CHANGES NEEDED)

| Consumer | Imports | Source Path |
|----------|---------|-------------|
| `src/agents/atlas/prompt-section-builder.ts` | `CATEGORY_DESCRIPTIONS` | `../../tools/delegate-task/constants` |
| `src/agents/builtin-agents.ts` | `CATEGORY_DESCRIPTIONS` | `../tools/delegate-task/constants` |
| `src/plugin/available-categories.ts` | `CATEGORY_DESCRIPTIONS` | `../tools/delegate-task/constants` |
| `src/plugin-handlers/category-config-resolver.ts` | `DEFAULT_CATEGORIES` | `../tools/delegate-task/constants` |
| `src/shared/merge-categories.ts` | `DEFAULT_CATEGORIES` | `../tools/delegate-task/constants` |
| `src/shared/merge-categories.test.ts` | `DEFAULT_CATEGORIES` | `../tools/delegate-task/constants` |

### Internal Import Map (Within delegate-task/ -- NO CHANGES NEEDED)

| Consumer | Imports |
|----------|---------|
| `categories.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_PROMPT_APPENDS` |
| `tools.ts` | `CATEGORY_DESCRIPTIONS` |
| `prompt-builder.ts` | `buildPlanAgentSystemPrepend`, `isPlanAgent` |
| `subagent-resolver.ts` | `isPlanFamily` |
| `sync-continuation.ts` | `isPlanFamily` |
| `sync-prompt-sender.ts` | `isPlanFamily` |
| `tools.test.ts` | `DEFAULT_CATEGORIES`, `CATEGORY_PROMPT_APPENDS`, `CATEGORY_DESCRIPTIONS`, `isPlanAgent`, `PLAN_AGENT_NAMES`, `isPlanFamily`, `PLAN_FAMILY_NAMES` |
