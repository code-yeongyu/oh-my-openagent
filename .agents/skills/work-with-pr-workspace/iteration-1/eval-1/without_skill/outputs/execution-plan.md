# Execution Plan: Add `max_background_agents` Config Option

## Overview

Add a `max_background_agents` config option to oh-my-opencode that limits total simultaneous background agents across all models/providers. Currently, concurrency is only limited per-model/provider key (default 5 per key). This new option adds a **global ceiling** on total running background agents.

## Step-by-Step Plan

### Step 1: Create feature branch

```bash
git checkout -b feat/max-background-agents dev
```

### Step 2: Add `max_background_agents` to BackgroundTaskConfigSchema

**File:** `src/config/schema/background-task.ts`

- Add `maxBackgroundAgents` field to the Zod schema with `z.number().int().min(1).optional()`
- This follows the existing pattern of `maxDepth` and `maxDescendants` (integer, min 1, optional)
- The field name uses camelCase to match existing schema fields (`defaultConcurrency`, `maxDepth`, `maxDescendants`)
- No `.default()` needed since the hardcoded fallback of 5 lives in `ConcurrencyManager`

### Step 3: Modify `ConcurrencyManager` to enforce global limit

**File:** `src/features/background-agent/concurrency.ts`

- Add a `globalCount` field tracking total active agents across all keys
- Modify `acquire()` to check global count against `maxBackgroundAgents` before granting a slot
- Modify `release()` to decrement global count
- Modify `clear()` to reset global count
- Add `getGlobalCount()` for testing/debugging (follows existing `getCount()`/`getQueueLength()` pattern)

The global limit check happens **in addition to** the per-model limit. Both must have capacity for a task to proceed.

### Step 4: Add tests for the new config schema field

**File:** `src/config/schema/background-task.test.ts`

- Add test cases following the existing given/when/then pattern with nested describes
- Test valid value, below-minimum value, undefined (not provided), non-number type

### Step 5: Add tests for ConcurrencyManager global limit

**File:** `src/features/background-agent/concurrency.test.ts`

- Test that global limit is enforced across different model keys
- Test that tasks queue when global limit reached even if per-model limit has capacity
- Test that releasing a slot from one model allows a queued task from another model to proceed
- Test default behavior (5) when no config provided
- Test interaction between global and per-model limits

### Step 6: Run typecheck and tests

```bash
bun run typecheck
bun test src/config/schema/background-task.test.ts
bun test src/features/background-agent/concurrency.test.ts
```

### Step 7: Verify LSP diagnostics clean

Check `src/config/schema/background-task.ts` and `src/features/background-agent/concurrency.ts` for errors.

### Step 8: Create PR

- Push branch to remote
- Create PR with structured description via `gh pr create`

## Files Modified (4 files)

| File | Change |
|------|--------|
| `src/config/schema/background-task.ts` | Add `maxBackgroundAgents` field |
| `src/features/background-agent/concurrency.ts` | Add global count tracking + enforcement |
| `src/config/schema/background-task.test.ts` | Add schema validation tests |
| `src/features/background-agent/concurrency.test.ts` | Add global limit enforcement tests |

## Files NOT Modified (intentional)

| File | Reason |
|------|--------|
| `src/config/schema/oh-my-opencode-config.ts` | No change needed - `BackgroundTaskConfigSchema` is already composed into root schema via `background_task` field |
| `src/create-managers.ts` | No change needed - `pluginConfig.background_task` already passed to `BackgroundManager` constructor |
| `src/features/background-agent/manager.ts` | No change needed - already passes config to `ConcurrencyManager` |
| `src/plugin-config.ts` | No change needed - `background_task` is a simple object field, uses default override merge |
| `src/config/schema.ts` | No change needed - barrel already exports `BackgroundTaskConfigSchema` |

## Design Decisions

1. **Field name `maxBackgroundAgents`** - camelCase to match existing schema fields (`maxDepth`, `maxDescendants`, `defaultConcurrency`). The user-facing JSONC config key is also camelCase per existing convention in `background_task` section.

2. **Global limit vs per-model limit** - The global limit is a ceiling across ALL concurrency keys. Per-model limits still apply independently. A task needs both a per-model slot AND a global slot to proceed.

3. **Default of 5** - Matches the existing hardcoded default in `getConcurrencyLimit()`. When `maxBackgroundAgents` is not set, no global limit is enforced (only per-model limits apply), preserving backward compatibility.

4. **Queue behavior** - When global limit is reached, tasks wait in the same FIFO queue mechanism. The global check happens inside `acquire()` before the per-model check.

5. **0 means Infinity** - Following the existing pattern where `defaultConcurrency: 0` means unlimited, `maxBackgroundAgents: 0` would also mean no global limit.
