# Verification Strategy

## 1. Type Safety

### 1a. LSP diagnostics on all new files
```
lsp_diagnostics("src/tools/delegate-task/default-categories.ts")
lsp_diagnostics("src/tools/delegate-task/category-descriptions.ts")
lsp_diagnostics("src/tools/delegate-task/category-prompt-appends.ts")
lsp_diagnostics("src/tools/delegate-task/plan-agent-prompt.ts")
lsp_diagnostics("src/tools/delegate-task/plan-agent-identity.ts")
lsp_diagnostics("src/shared/category-model-requirements.ts")
```

### 1b. LSP diagnostics on modified files
```
lsp_diagnostics("src/tools/delegate-task/constants.ts")
lsp_diagnostics("src/shared/model-requirements.ts")
```

### 1c. Full typecheck
```bash
bun run typecheck
```
Expected: 0 errors. This confirms all 14 consumer files (8 internal + 6 external) resolve their imports correctly through the barrel re-exports.

## 2. Behavioral Regression

### 2a. Existing test suite
```bash
bun test src/tools/delegate-task/tools.test.ts
```
This test file imports `DEFAULT_CATEGORIES`, `CATEGORY_PROMPT_APPENDS`, `CATEGORY_DESCRIPTIONS`, `isPlanAgent`, `PLAN_AGENT_NAMES`, `isPlanFamily`, `PLAN_FAMILY_NAMES` from `./constants`. If the barrel re-export is correct, all these tests pass unchanged.

### 2b. Category resolver tests
```bash
bun test src/tools/delegate-task/category-resolver.test.ts
```
This exercises `resolveCategoryConfig()` which imports `DEFAULT_CATEGORIES` and `CATEGORY_PROMPT_APPENDS` from `./constants` and `CATEGORY_MODEL_REQUIREMENTS` from `../../shared/model-requirements`.

### 2c. Model selection tests
```bash
bun test src/tools/delegate-task/model-selection.test.ts
```

### 2d. Merge categories tests
```bash
bun test src/shared/merge-categories.test.ts
```
Imports `DEFAULT_CATEGORIES` from `../tools/delegate-task/constants` (external path).

### 2e. Full test suite
```bash
bun test
```

## 3. Build Verification

```bash
bun run build
```
Confirms ESM bundle + declarations emit correctly with the new file structure.

## 4. Export Completeness Verification

### 4a. Verify `constants.ts` re-exports match original exports
Cross-check that every symbol previously exported from `constants.ts` is still exported. The original file exported these symbols:
- `VISUAL_CATEGORY_PROMPT_APPEND`
- `ULTRABRAIN_CATEGORY_PROMPT_APPEND`
- `ARTISTRY_CATEGORY_PROMPT_APPEND`
- `QUICK_CATEGORY_PROMPT_APPEND`
- `UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND`
- `UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND`
- `WRITING_CATEGORY_PROMPT_APPEND`
- `DEEP_CATEGORY_PROMPT_APPEND`
- `DEFAULT_CATEGORIES`
- `CATEGORY_PROMPT_APPENDS`
- `CATEGORY_DESCRIPTIONS`
- `PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS`
- `PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS`
- `buildPlanAgentSkillsSection`
- `buildPlanAgentSystemPrepend`
- `PLAN_AGENT_NAMES`
- `isPlanAgent`
- `PLAN_FAMILY_NAMES`
- `isPlanFamily`

All 19 must be re-exported from the barrel.

### 4b. Verify `model-requirements.ts` re-exports match original exports
Original exports: `FallbackEntry`, `ModelRequirement`, `AGENT_MODEL_REQUIREMENTS`, `CATEGORY_MODEL_REQUIREMENTS`. All 4 must still be available.

## 5. LOC Compliance Check

Verify each new file is under 200 LOC (excluding prompt template text per modular-code-enforcement rule):

| File | Expected Total LOC | Non-prompt LOC | Compliant? |
|------|-------------------|----------------|------------|
| `default-categories.ts` | ~15 | ~15 | Yes |
| `category-descriptions.ts` | ~12 | ~12 | Yes |
| `category-prompt-appends.ts` | ~280 | ~15 | Yes (prompt exempt) |
| `plan-agent-prompt.ts` | ~270 | ~40 | Yes (prompt exempt) |
| `plan-agent-identity.ts` | ~35 | ~35 | Yes |
| `category-model-requirements.ts` | ~150 | ~150 | Yes |
| `model-requirements.ts` (after) | ~165 | ~165 | Yes |
| `constants.ts` (after) | ~25 | ~25 | Yes |

## 6. Consumer Impact Matrix

Verify zero consumer files need changes:

| Consumer File | Import Path | Should Still Work? |
|--------------|-------------|-------------------|
| `delegate-task/categories.ts` | `./constants` | Yes (barrel) |
| `delegate-task/tools.ts` | `./constants` | Yes (barrel) |
| `delegate-task/tools.test.ts` | `./constants` | Yes (barrel) |
| `delegate-task/prompt-builder.ts` | `./constants` | Yes (barrel) |
| `delegate-task/subagent-resolver.ts` | `./constants` | Yes (barrel) |
| `delegate-task/sync-continuation.ts` | `./constants` | Yes (barrel) |
| `delegate-task/sync-prompt-sender.ts` | `./constants` | Yes (barrel) |
| `delegate-task/index.ts` | `./constants` | Yes (barrel) |
| `agents/atlas/prompt-section-builder.ts` | `../../tools/delegate-task/constants` | Yes (barrel) |
| `agents/builtin-agents.ts` | `../tools/delegate-task/constants` | Yes (barrel) |
| `plugin/available-categories.ts` | `../tools/delegate-task/constants` | Yes (barrel) |
| `plugin-handlers/category-config-resolver.ts` | `../tools/delegate-task/constants` | Yes (barrel) |
| `shared/merge-categories.ts` | `../tools/delegate-task/constants` | Yes (barrel) |
| `shared/merge-categories.test.ts` | `../tools/delegate-task/constants` | Yes (barrel) |
| `delegate-task/categories.ts` | `../../shared/model-requirements` | Yes (re-export) |
