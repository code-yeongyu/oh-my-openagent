# Verification Strategy

## Gate A: CI (Blocking)

```bash
gh pr checks --watch
```

**Expected CI jobs** (from `ci.yml`):
1. **Tests (split)**: mock-heavy isolated + batch `bun test`
2. **Typecheck**: `bun run typecheck` (tsc --noEmit)
3. **Build**: `bun run build`
4. **Schema auto-commit**: If schema changes detected

**Likely failure points**: None. This is a pure refactor with re-exports. No runtime behavior changes.

**If CI fails**:
- Typecheck error: Missing re-export or import cycle. Fix in the new modules, amend commit.
- Test error: `tools.test.ts` imports all symbols from `"./constants"`. Re-export barrel must be complete.

## Gate B: review-work (5-Agent Review)

Invoke after CI passes:

```
/review-work
```

**5 parallel agents**:
1. **Oracle (goal/constraint)**: Verify backward compat claim. Check all 13 import paths resolve.
2. **Oracle (code quality)**: Verify single-responsibility per file, LOC limits, no catch-all violations.
3. **Oracle (security)**: No security implications in this refactor.
4. **QA (hands-on execution)**: Run `bun test src/tools/delegate-task/` and verify all pass.
5. **Context miner**: Check no related open issues/PRs conflict.

**Expected verdict**: Pass. Pure structural refactor with no behavioral changes.

## Gate C: Cubic (External Bot)

Wait for `cubic-dev-ai[bot]` to post "No issues found" on the PR.

**If Cubic flags issues**: Likely false positives on "large number of new files". Address in PR comments if needed.

## Pre-Gate Local Validation (Before Push)

```bash
# In worktree
bun run typecheck
bun test src/tools/delegate-task/
bun run build

# Verify re-exports are complete
bun -e "import * as c from './src/tools/delegate-task/constants'; console.log(Object.keys(c).sort().join('\n'))"
```

Expected exports from constants.ts (13 total):
- `ARTISTRY_CATEGORY_PROMPT_APPEND`
- `CATEGORY_DESCRIPTIONS`
- `CATEGORY_PROMPT_APPENDS`
- `DEFAULT_CATEGORIES`
- `DEEP_CATEGORY_PROMPT_APPEND`
- `PLAN_AGENT_NAMES`
- `PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS`
- `PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS`
- `PLAN_FAMILY_NAMES`
- `QUICK_CATEGORY_PROMPT_APPEND`
- `ULTRABRAIN_CATEGORY_PROMPT_APPEND`
- `UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND`
- `UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND`
- `VISUAL_CATEGORY_PROMPT_APPEND`
- `WRITING_CATEGORY_PROMPT_APPEND`
- `buildPlanAgentSkillsSection`
- `buildPlanAgentSystemPrepend`
- `isPlanAgent`
- `isPlanFamily`

## Merge Strategy

```bash
gh pr merge --squash --delete-branch
git worktree remove ../omo-wt/refactor-delegate-task-constants
```

Squash merge collapses the 2 atomic commits into 1 clean commit on dev.
