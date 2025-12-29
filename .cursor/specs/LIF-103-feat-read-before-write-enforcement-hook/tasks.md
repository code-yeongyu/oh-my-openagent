# Read-Before-Write Enforcement Hook - Task Breakdown

**Linear Issue**: [LIF-103](https://linear.app/lifelogger/issue/LIF-103/read-before-write-enforcement-hook)
**Created**: 2025-12-28
**Total Estimate**: 4.75h

---

## Phase 1: Core Infrastructure (1.5h)

**Goal**: Create the foundational types, constants, and registry singleton that will power the hook.

| ID | Task | Status | Estimate | Files | Dependencies | Notes |
|----|------|--------|----------|-------|--------------|-------|
| T1.1 | Create types.ts with interfaces | Not Started | 15min | `src/hooks/read-before-write/types.ts` | None | FileReadEntry, ReadBeforeWriteConfig, EnforcementResult |
| T1.2 | Create constants.ts with defaults | Not Started | 15min | `src/hooks/read-before-write/constants.ts` | T1.1 | HOOK_NAME, DEFAULT_CONFIG, ERROR_MESSAGES, MAX_TRACKED_FILES |
| T1.3 | Implement FileReadRegistry with LRU cache | Not Started | 45min | `src/hooks/read-before-write/registry.ts` | T1.1, T1.2 | Map<sessionId, LRUCache<path, timestamp>>, O(1) operations, auto-eviction |
| T1.4 | Add GovernanceReadBeforeWriteSchema to config | Not Started | 15min | `src/config/schema.ts` | T1.1 | Add schema, update GovernanceConfigSchema, export type |

**Checkpoint**: All files compile with `bun run typecheck`. Registry can be instantiated and methods called.

### Task Details

**T1.1: Create types.ts**
- Define `FileReadEntry` interface (filePath, sessionId, timestamp)
- Define `ReadBeforeWriteConfig` interface (enabled, mode, exempt_tools, exempt_paths)
- Define `EnforcementResult` interface (allowed, reason, message?)
- Define `EnforcementReason` type union
- Export all types

**T1.2: Create constants.ts**
- `HOOK_NAME = "read-before-write"`
- `MAX_TRACKED_FILES = 10000` (per NFR-1)
- `DEFAULT_CONFIG` with spec defaults:
  - enabled: true
  - mode: "block"
  - exempt_tools: ["lsp_rename", "lsp_code_action_resolve", "ast_grep_replace", "memory_write", "memory_edit", "memory_delete", "create_spec_folder", "update_workflow_state"]
  - exempt_paths: ["dist/**", "build/**", "node_modules/**", ".git/**"]
- `ERROR_MESSAGES.blocked(filePath)` - returns ASCII formatted block message `[BLOCKED] Read-Before-Write: ...`
- `WARNING_MESSAGES.noRead(filePath)` - returns ASCII formatted warning `[WARNING] Read-Before-Write: ...`

**T1.3: Implement FileReadRegistry with LRU Cache**
- Follow `conflict-detector/registry.ts` singleton pattern
- Private static instance, private constructor
- LRU Cache using JavaScript Map's insertion-order guarantee:
  - `Map<sessionId, Map<normalizedPath, timestamp>>`
  - `map.keys().next().value` returns oldest entry (first inserted)
  - Delete + re-insert moves entry to end (most recently used)
  - O(1) lookup, O(1) insertion, O(1) eviction
- Methods:
  - `getInstance(maxFilesPerSession?)` - singleton accessor
  - `resetInstance()` - for testing
  - `recordRead(sessionId, filePath)` - add with timestamp, LRU evict if needed
  - `hasRead(sessionId, filePath)` - check if file was read
  - `clearSession(sessionId)` - remove session data
  - `getStats()` - return { totalSessions, totalFiles }
  - `reset()` - clear all data
- Automatic LRU eviction when session exceeds MAX_TRACKED_FILES

**T1.4: Add schema to config**
- Create `GovernanceReadBeforeWriteSchema` with Zod
- Add `read_before_write: GovernanceReadBeforeWriteSchema.optional()` to `GovernanceConfigSchema`
- Export `GovernanceReadBeforeWriteConfig` type
- Add `"read-before-write"` to `HookNameSchema` enum

---

## Phase 2: Hook Implementation (1.5h)

**Goal**: Implement the core hook logic with read tracking and write enforcement.

| ID | Task | Status | Estimate | Files | Dependencies | Notes |
|----|------|--------|----------|-------|--------------|-------|
| T2.1 | Implement tool.execute.before handler (combined) | Not Started | 45min | `src/hooks/read-before-write/index.ts` | T1.3 | Track reads AND enforce in same handler (SDK constraint) |
| T2.2 | Implement multiedit handling | Not Started | 30min | `src/hooks/read-before-write/index.ts` | T2.1 | Check each file in multiedit individually |
| T2.3 | Implement event handler for cleanup | Not Started | 15min | `src/hooks/read-before-write/index.ts` | T1.3 | Handle session.deleted, session.compacted with defensive pattern |

**Checkpoint**: Hook can be instantiated. Read tracking works. Write enforcement blocks/warns correctly.

### Task Details

**T2.1: Implement tool.execute.before handler (COMBINED tracking + enforcement)**

**SDK CONSTRAINT**: `tool.execute.after` does NOT have access to `output.args` (only `title`, `output`, `metadata`). Therefore, BOTH read tracking AND enforcement MUST happen in `tool.execute.before`.

```typescript
"tool.execute.before": async (input, output) => {
  const toolLower = input.tool.toLowerCase();
  
  // TRACKING: Record reads
  if (toolLower === "read") {
    const filePath = output.args.filePath ?? output.args.file_path ?? output.args.path;
    if (filePath && typeof filePath === "string") {
      registry.recordRead(input.sessionID, path.resolve(filePath));
    }
    return; // Read tracking done, exit early
  }
  
  // ENFORCEMENT: Check write/edit/multiedit
  if (!["write", "edit", "multiedit"].includes(toolLower)) return;
  
  // Check tool exemption first (fast path)
  if (config.exempt_tools.includes(input.tool)) return;
  
  // Handle single file tools
  if (toolLower === "write" || toolLower === "edit") {
    const filePath = output.args.filePath ?? output.args.file_path;
    if (!filePath) return;
    enforceReadBeforeWrite(input.sessionID, filePath as string);
  }
  
  // Handle multiedit (see T2.2)
  if (toolLower === "multiedit") {
    handleMultiedit(input.sessionID, output.args);
  }
}
```
- Handle multiple argument names (filePath, file_path, path)
- Normalize path with `path.resolve()`
- Combine tracking and enforcement in single handler

**T2.2: Implement multiedit handling**

The `multiedit` tool can edit multiple files in one operation. Each file must be checked individually.

```typescript
function handleMultiedit(sessionID: string, args: Record<string, unknown>): void {
  // multiedit args structure: { edits: [{ filePath, ... }, ...] }
  const edits = args.edits as Array<{ filePath?: string; file_path?: string }> | undefined;
  if (!Array.isArray(edits)) return;
  
  for (const edit of edits) {
    const filePath = edit.filePath ?? edit.file_path;
    if (filePath && typeof filePath === "string") {
      enforceReadBeforeWrite(sessionID, filePath);
    }
  }
}
```

**T2.3: Implement event handler**
```typescript
event: async ({ event }) => {
  const props = event.properties as Record<string, unknown> | undefined;
  
  if (event.type === "session.deleted") {
    const sessionInfo = props?.info as { id?: string } | undefined;
    if (sessionInfo?.id) {
      registry.clearSession(sessionInfo.id);
    }
  }
  
  // Defensive pattern for session.compacted (per codebase convention)
  if (event.type === "session.compacted") {
    const sessionID = (props?.sessionID ??
      (props?.info as { id?: string } | undefined)?.id) as string | undefined;
    if (sessionID) {
      registry.clearSession(sessionID);
    }
  }
}
```
- Handle session.deleted via `props.info.id`
- Handle session.compacted with defensive fallback `props.sessionID ?? props.info.id`

---

## Phase 3: Integration (45min)

**Goal**: Wire the hook into the plugin system and update documentation.

| ID | Task | Status | Estimate | Files | Dependencies | Notes |
|----|------|--------|----------|-------|--------------|-------|
| T3.1 | Export from hooks/index.ts | Not Started | 5min | `src/hooks/index.ts` | T2.3 | Export hook factory and types |
| T3.2 | Add HookName to schema.ts enum | Not Started | 5min | `src/config/schema.ts` | T1.4 | Already done in T1.4, verify |
| T3.3 | Wire up in main plugin index.ts | Not Started | 20min | `src/index.ts` | T3.1 | Import, create, add to handlers |
| T3.4 | Update README documentation | Not Started | 15min | `README.md` | T3.3 | Add to Governance section |

**Checkpoint**: Hook loads with plugin. `bun run build` succeeds. README documents the feature.

### Task Details

**T3.1: Export from hooks/index.ts**
```typescript
// Add to governance hooks section
export { createReadBeforeWriteHook } from "./read-before-write";
export type { ReadBeforeWriteConfig } from "./read-before-write";
```

**T3.2: Verify HookName in schema.ts**
- Confirm `"read-before-write"` is in `HookNameSchema` enum (done in T1.4)
- If not, add it

**T3.3: Wire up in main plugin index.ts**
- Import `createReadBeforeWriteHook` from hooks
- Get config from `governance.read_before_write`
- Create hook instance with config
- Add `tool.execute.before` handler (run BEFORE conflict-detector)
- Add `tool.execute.after` handler
- Add event handler for session cleanup
- Check `disabled_hooks` array before enabling

**T3.4: Update README documentation**
- Add to Governance Hooks table:
  | `read-before-write` | Enforces agents read files before editing. Prevents wasted tokens from failed edit attempts. |
- Add configuration example to Governance Configuration section
- Document all config options (enabled, mode, exempt_tools, exempt_paths)

---

## Phase 4: Testing & Validation (1h)

**Goal**: Verify all functionality works correctly through manual testing.

| ID | Task | Status | Estimate | Files | Dependencies | Notes |
|----|------|--------|----------|-------|--------------|-------|
| T4.1 | Manual testing: basic flow | Not Started | 20min | - | T3.3 | Read then edit, edit without read |
| T4.2 | Manual testing: exemptions | Not Started | 15min | - | T3.3 | Tool exemptions, path exemptions |
| T4.3 | Manual testing: new file creation | Not Started | 10min | - | T3.3 | Write to non-existent file |
| T4.4 | Manual testing: session cleanup | Not Started | 15min | - | T3.3 | Verify registry clears on session end |

**Checkpoint**: All test scenarios pass. No regressions in existing functionality.

### Task Details

**T4.1: Manual testing: basic flow**
- [ ] Start OpenCode session
- [ ] Read a file using Read tool
- [ ] Edit the same file → Should succeed
- [ ] Try to edit a different file without reading → Should block (mode: block)
- [ ] Change mode to "warn" in config
- [ ] Try to edit without reading → Should warn but allow
- [ ] Verify log messages are clear and actionable

**T4.2: Manual testing: exemptions**
- [ ] Use `lsp_rename` on a file without reading → Should succeed (tool exempt)
- [ ] Use `memory_write` → Should succeed (tool exempt)
- [ ] Edit file in `dist/` directory → Should succeed (path exempt)
- [ ] Edit file in `node_modules/` → Should succeed (path exempt)
- [ ] Add custom tool to `exempt_tools` config → Should bypass

**T4.3: Manual testing: new file creation**
- [ ] Write to a file that doesn't exist → Should succeed
- [ ] Create file, then immediately edit → Should work (file was just created)
- [ ] Verify no false positives for new file workflows

**T4.4: Manual testing: session cleanup**
- [ ] Start session, read several files
- [ ] Check registry stats (via debug logging)
- [ ] End session (or trigger compaction)
- [ ] Verify registry cleared session data
- [ ] Start new session, verify clean state

---

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Core Infrastructure | 4 tasks | 1.5h | Not Started |
| Phase 2: Hook Implementation | 3 tasks | 1.5h | Not Started |
| Phase 3: Integration | 4 tasks | 0.75h | Not Started |
| Phase 4: Testing & Validation | 4 tasks | 1h | Not Started |
| **Total** | **15 tasks** | **4.75h** | - |

---

## Recommended Execution Order

### Sequential Dependencies

1. **T1.1** (types.ts) - Foundation for all other files
2. **T1.2** (constants.ts) - Depends on types
3. **T1.3** (registry.ts) - Depends on types and constants
4. **T1.4** (schema.ts) - Can run parallel with T1.3 after T1.1
5. **Commit Phase 1** - "feat(hooks): add read-before-write core infrastructure"

6. **T2.1** (tool.execute.before) - Depends on registry
7. **T2.2** (tool.execute.before) - Depends on T2.1 for testing
8. **T2.3** (event handler) - Can run parallel with T2.2
9. **Commit Phase 2** - "feat(hooks): implement read-before-write hook logic"

10. **T3.1** (hooks/index.ts export) - Depends on Phase 2
11. **T3.2** (verify schema) - Quick verification
12. **T3.3** (main plugin wiring) - Depends on T3.1
13. **T3.4** (README) - Can run parallel with T3.3
14. **Commit Phase 3** - "feat(hooks): integrate read-before-write hook"

15. **T4.1-T4.4** (testing) - Sequential, depends on Phase 3
16. **Final Commit** - "test: validate read-before-write hook functionality"

### Parallelization Opportunities

- T1.3 and T1.4 can run in parallel after T1.1 + T1.2
- T2.2 and T2.3 can run in parallel after T2.1
- T3.3 and T3.4 can run in parallel after T3.1

---

## Notes

### Critical Implementation Details

1. **Path Normalization**: Always use `path.resolve()` to normalize paths before storing/comparing
2. **Case Sensitivity**: Tool names should be compared case-insensitively
3. **Argument Names**: Handle multiple argument names (filePath, file_path, path)
4. **File Existence**: Use `existsSync` from `node:fs` for synchronous check
5. **Glob Matching**: Use `minimatch` for exempt_paths pattern matching

### Dependencies Between Tasks

- All Phase 2 tasks depend on Phase 1 completion
- All Phase 3 tasks depend on Phase 2 completion
- All Phase 4 tasks depend on Phase 3 completion

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Path normalization edge cases | Use `path.resolve()`, test with relative/absolute paths |
| Memory growth in long sessions | MAX_TRACKED_FILES limit with pruning |
| False positives blocking workflows | Comprehensive exemption system, warn mode for rollout |
| Integration conflicts with conflict-detector | Run read-before-write BEFORE conflict-detector |

### Files to Create

```
src/hooks/read-before-write/
├── index.ts       # Hook factory: createReadBeforeWriteHook()
├── registry.ts    # FileReadRegistry singleton class
├── types.ts       # TypeScript interfaces
└── constants.ts   # Default config, hook name, messages
```

### Files to Modify

- `src/config/schema.ts` - Add schema and hook name
- `src/hooks/index.ts` - Export hook
- `src/index.ts` - Wire hook into plugin
- `README.md` - Document feature

### Success Criteria

- [ ] 95% reduction in "must read first" errors
- [ ] <5ms latency per enforcement check
- [ ] Max 10,000 files tracked per session
- [ ] <1% false positive rate
- [ ] All manual tests pass
- [ ] `bun run build` succeeds
- [ ] `bun run typecheck` passes
