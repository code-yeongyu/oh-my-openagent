# Verification Strategy

## 1. Static Analysis

### TypeScript Typecheck
```bash
bun run typecheck
```
- Verify no type errors introduced
- `BackgroundTaskConfig` type is inferred from Zod schema, so adding the field automatically updates the type
- All existing consumers of `BackgroundTaskConfig` remain compatible (new field is optional)

### LSP Diagnostics
Check changed files for errors:
- `src/config/schema/background-task.ts`
- `src/features/background-agent/concurrency.ts`
- `src/config/schema/background-task.test.ts`
- `src/features/background-agent/concurrency.test.ts`

## 2. Unit Tests

### Schema Validation Tests
```bash
bun test src/config/schema/background-task.test.ts
```

| Test Case | Input | Expected |
|-----------|-------|----------|
| Valid value (10) | `{ maxBackgroundAgents: 10 }` | Parses to `10` |
| Minimum boundary (1) | `{ maxBackgroundAgents: 1 }` | Parses to `1` |
| Below minimum (0) | `{ maxBackgroundAgents: 0 }` | Throws `ZodError` |
| Negative (-1) | `{ maxBackgroundAgents: -1 }` | Throws `ZodError` |
| Non-integer (2.5) | `{ maxBackgroundAgents: 2.5 }` | Throws `ZodError` |
| Not provided | `{}` | Field is `undefined` |

### ConcurrencyManager Tests
```bash
bun test src/features/background-agent/concurrency.test.ts
```

| Test Case | Setup | Expected |
|-----------|-------|----------|
| No config = no global limit | No `maxBackgroundAgents` | `getGlobalLimit()` returns `Infinity` |
| Config respected | `maxBackgroundAgents: 3` | `getGlobalLimit()` returns `3` |
| Cross-model blocking | Global limit 2, acquire model-a + model-b, try model-c | model-c blocks |
| Under-limit allows | Global limit 3, acquire 3 different models | All succeed |
| Per-model + global interaction | Per-model 1, global 3, acquire model-a twice | Blocked by per-model, not global |
| Release unblocks | Global limit 1, acquire model-a, queue model-b, release model-a | model-b proceeds |
| No global limit = no enforcement | No config, acquire 6 different models | All succeed |
| Clear resets global count | Acquire 2, clear | `getGlobalCount()` is 0 |

### Existing Test Regression
```bash
bun test src/features/background-agent/concurrency.test.ts
bun test src/config/schema/background-task.test.ts
bun test src/config/schema.test.ts
```
All existing tests must continue to pass unchanged.

## 3. Integration Verification

### Config Loading Path
Verify the config flows correctly through the system:

1. **Schema → Type**: `BackgroundTaskConfig` type auto-includes `maxBackgroundAgents` via `z.infer`
2. **Config file → Schema**: `loadConfigFromPath()` in `plugin-config.ts` uses `OhMyOpenCodeConfigSchema.safeParse()` which includes `BackgroundTaskConfigSchema`
3. **Config → Manager**: `create-managers.ts` passes `pluginConfig.background_task` to `BackgroundManager` constructor
4. **Manager → ConcurrencyManager**: `BackgroundManager` constructor passes config to `new ConcurrencyManager(config)`
5. **ConcurrencyManager → Enforcement**: `acquire()` reads `config.maxBackgroundAgents` via `getGlobalLimit()`

No changes needed in steps 2-4 since the field is optional and the existing plumbing passes the entire `BackgroundTaskConfig` object.

### Manual Config Test
Create a test config to verify parsing:
```bash
echo '{ "background_task": { "maxBackgroundAgents": 3 } }' | bun -e "
  const { BackgroundTaskConfigSchema } = require('./src/config/schema/background-task');
  const result = BackgroundTaskConfigSchema.safeParse(JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8')).background_task);
  console.log(result.success, result.data);
"
```

## 4. Build Verification

```bash
bun run build
```
- Verify build succeeds
- Schema JSON output includes the new field (if applicable)

## 5. Edge Cases to Verify

| Edge Case | Expected Behavior |
|-----------|-------------------|
| `maxBackgroundAgents` not set | No global limit enforced (backward compatible) |
| `maxBackgroundAgents: 1` | Only 1 background agent at a time across all models |
| `maxBackgroundAgents` > sum of all per-model limits | Global limit never triggers (per-model limits are tighter) |
| Per-model limit tighter than global | Per-model limit blocks first |
| Global limit tighter than per-model | Global limit blocks first |
| Release from one model unblocks different model | Global slot freed, different model's waiter proceeds |
| Manager shutdown with global waiters | `clear()` rejects all waiters and resets global count |
| Concurrent acquire/release | No race conditions (single-threaded JS event loop) |

## 6. CI Pipeline

The existing CI workflow (`ci.yml`) will run:
- `bun run typecheck` - type checking
- `bun test` - all tests including new ones
- `bun run build` - build verification

No CI changes needed.
