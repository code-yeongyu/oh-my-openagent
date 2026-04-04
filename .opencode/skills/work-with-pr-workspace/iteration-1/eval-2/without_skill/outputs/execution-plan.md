# Execution Plan: Fix Atlas Hook Crash on Missing worktree_path

## Bug Analysis

### Root Cause

`readBoulderState()` in `src/features/boulder-state/storage.ts` performs minimal validation when parsing `boulder.json`:

```typescript
const parsed = JSON.parse(content)
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
if (!Array.isArray(parsed.session_ids)) parsed.session_ids = []
return parsed as BoulderState  // <-- unsafe cast, no field validation
```

It validates `session_ids` but NOT `active_plan`, `plan_name`, or `worktree_path`. This means a malformed `boulder.json` (e.g., `{}` or missing key fields) passes through and downstream code crashes.

### Crash Path

1. `boulder.json` is written without required fields (manual edit, corruption, partial write)
2. `readBoulderState()` returns it as `BoulderState` with `active_plan: undefined`
3. Multiple call sites pass `boulderState.active_plan` to `getPlanProgress(planPath: string)`:
   - `src/hooks/atlas/idle-event.ts:72` (inside `setTimeout` callback - unhandled rejection!)
   - `src/hooks/atlas/resolve-active-boulder-session.ts:21`
   - `src/hooks/atlas/tool-execute-after.ts:74`
4. `getPlanProgress()` calls `existsSync(undefined)` which throws: `TypeError: The "path" argument must be of type string`

### worktree_path-Specific Issues

When `worktree_path` field is missing from `boulder.json`:
- The `idle-event.ts` `scheduleRetry` setTimeout callback (lines 62-88) has NO try/catch. An unhandled promise rejection from the async callback crashes the process.
- `readBoulderState()` returns `worktree_path: undefined` which itself is handled in `boulder-continuation-injector.ts` (line 42 uses truthiness check), but the surrounding code in the setTimeout lacks error protection.

### Secondary Issue: Unhandled Promise in setTimeout

In `idle-event.ts` lines 62-88:
```typescript
sessionState.pendingRetryTimer = setTimeout(async () => {
  // ... no try/catch wrapper
  const currentBoulder = readBoulderState(ctx.directory)
  const currentProgress = getPlanProgress(currentBoulder.active_plan)  // CRASH if active_plan undefined
  // ...
}, RETRY_DELAY_MS)
```

The async callback creates a floating promise. Any thrown error becomes an unhandled rejection.

---

## Step-by-Step Plan

### Step 1: Harden `readBoulderState()` validation
**File:** `src/features/boulder-state/storage.ts`

- After the `session_ids` fix, add validation for `active_plan` and `plan_name` (required fields)
- Validate `worktree_path` is either `undefined` or a string (not `null`, not a number)
- Return `null` for boulder states with missing required fields

### Step 2: Add try/catch in setTimeout callback
**File:** `src/hooks/atlas/idle-event.ts`

- Wrap the `setTimeout` async callback body in try/catch
- Log errors with the atlas hook logger

### Step 3: Add defensive guard in `getPlanProgress`
**File:** `src/features/boulder-state/storage.ts`

- Add early return for non-string `planPath` argument

### Step 4: Add tests
**Files:**
- `src/features/boulder-state/storage.test.ts` - test missing/malformed fields
- `src/hooks/atlas/index.test.ts` - test atlas hook with boulder missing worktree_path

### Step 5: Run CI checks
```bash
bun run typecheck
bun test src/features/boulder-state/storage.test.ts
bun test src/hooks/atlas/index.test.ts
bun test  # full suite
```

### Step 6: Create PR
- Branch: `fix/atlas-hook-missing-worktree-path`
- Target: `dev`
- Run CI and verify passes
