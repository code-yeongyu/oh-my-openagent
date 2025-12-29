# Read-Before-Write Enforcement Hook - Implementation Plan

**Linear Issue**: [LIF-103](https://linear.app/lifelogger/issue/LIF-103/read-before-write-enforcement-hook)
**Created**: 2025-12-28
**Author**: Strategic Planner (OmO)

## Summary

Implement a hook that tracks file reads and enforces read-before-write behavior for `edit`, `write`, and `multiedit` tools. The hook uses a singleton registry pattern (following `conflict-detector`) with an LRU cache for bounded memory usage, configurable enforcement modes (block/warn/disabled), and exemption lists for tools and paths.

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Files** | `src/hooks/read-before-write/` (new directory) |
| **Reference Patterns** | `conflict-detector`, `governance-path-validator` |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| **I. Plugin-First Architecture** | ✅ Uses @opencode-ai/plugin SDK, `tool.execute.before`/`after` hooks |
| **IV. Bun-Native Development** | ✅ Uses Bun exclusively, node:fs for file existence checks |
| **V. Hook-Driven Enhancement** | ✅ Implemented as lifecycle hook with configurable enable/disable |

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Read-Before-Write Hook                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐         ┌──────────────────────────────────┐  │
│  │    index.ts      │◄───────►│        FileReadRegistry          │  │
│  │                  │         │        (Singleton)               │  │
│  │ - tool.execute.  │         ├──────────────────────────────────┤  │
│  │   before (both)  │         │ - sessions: Map<sessionId,       │  │
│  │ - event handlers │         │              LRUCache<path,ts>>  │  │
│  │                  │         │ - config: ReadBeforeWriteConfig  │  │
│  └────────┬─────────┘         │ - recordRead(session, path)      │  │
│           │                   │ - hasRead(session, path)         │  │
│           │                   │ - clearSession(sessionId)        │  │
│           │                   │ - getStats()                     │  │
│           │                   └──────────────────────────────────┘  │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐         ┌──────────────────────────────────┐  │
│  │    types.ts      │         │         constants.ts             │  │
│  │                  │         │                                  │  │
│  │ - FileReadEntry  │         │ - HOOK_NAME                      │  │
│  │ - Config types   │         │ - DEFAULT_CONFIG                 │  │
│  │ - EnforcementRe- │         │ - ERROR_MESSAGES                 │  │
│  │   sult           │         │ - WARNING_MESSAGES               │  │
│  └──────────────────┘         └──────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. TRACKING FLOW (tool.execute.before on "read" tool):
   ┌─────────┐     ┌───────────────┐     ┌────────────────────┐
   │  Read   │────►│ Extract path  │────►│ Normalize path     │
   │  Tool   │     │ from output.  │     │ (path.resolve)     │
   └─────────┘     │ args          │     └────────┬───────────┘
                   └───────────────┘              │
                                                  ▼
                                         ┌────────────────────┐
                                         │ registry.recordRead│
                                         │ (sessionId, path,  │
                                         │  timestamp)        │
                                         └────────────────────┘

   NOTE: Uses tool.execute.before because tool.execute.after does NOT
   have access to output.args (only title, output, metadata per SDK).

2. ENFORCEMENT FLOW (tool.execute.before on "write"/"edit"/"multiedit"):
   ┌─────────┐     ┌───────────────┐     ┌────────────────────┐
   │ Write/  │────►│ Check tool    │────►│ Check path         │
   │ Edit    │     │ exemption     │     │ exemption          │
   └─────────┘     └───────┬───────┘     └────────┬───────────┘
                           │                       │
                   (exempt)│               (exempt)│
                           ▼                       ▼
                       ALLOW                   ALLOW
                           │                       │
                   (not exempt)           (not exempt)
                           ▼                       ▼
                   ┌───────────────────────────────┴───────────┐
                   │                                           │
                   ▼                                           │
           ┌───────────────┐                                   │
           │ Check if file │                                   │
           │ exists        │                                   │
           └───────┬───────┘                                   │
                   │                                           │
           (doesn't exist) ────────► ALLOW (new file creation) │
                   │                                           │
           (exists)▼                                           │
           ┌───────────────┐                                   │
           │ registry.     │                                   │
           │ hasRead()     │                                   │
           └───────┬───────┘                                   │
                   │                                           │
              (yes)│                                           │
                   ▼                                           │
               ALLOW                                           │
                   │                                           │
              (no) ▼                                           │
           ┌───────────────┐                                   │
           │ Check mode:   │                                   │
           │ block/warn    │                                   │
           └───────┬───────┘                                   │
                   │                                           │
           (block) │              (warn)                       │
                   ▼                 ▼                         │
               throw Error      log warning                    │
                               continue                        │
                               ◄───────────────────────────────┘
```

## Data Models

### FileReadEntry

```typescript
export interface FileReadEntry {
  filePath: string;           // Normalized absolute path
  sessionId: string;          // Session that performed the read
  timestamp: number;          // When the read occurred
}
```

### ReadBeforeWriteConfig

```typescript
export interface ReadBeforeWriteConfig {
  enabled: boolean;                // Master enable/disable
  mode: "block" | "warn" | "disabled";  // Enforcement mode
  exempt_tools: string[];          // Tools that bypass enforcement
  exempt_paths: string[];          // Glob patterns for exempt paths
}
```

### EnforcementResult

```typescript
export interface EnforcementResult {
  allowed: boolean;
  reason: "read_found" | "new_file" | "tool_exempt" | "path_exempt" | "disabled";
  message?: string;
}
```

## Configuration Schema

Add to `src/config/schema.ts`:

```typescript
// Add to GovernanceConfigSchema
export const GovernanceReadBeforeWriteSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["block", "warn", "disabled"]).default("block"),
  exempt_tools: z.array(z.string()).default([
    "lsp_rename",
    "lsp_code_action_resolve",
    "ast_grep_replace",
    "memory_write",
    "memory_edit",
    "memory_delete",
    "create_spec_folder",
    "update_workflow_state"
  ]),
  exempt_paths: z.array(z.string()).default([
    "dist/**",
    "build/**",
    "node_modules/**",
    ".git/**"
  ]),
})

// Update GovernanceConfigSchema to include
export const GovernanceConfigSchema = z.object({
  // ... existing fields
  read_before_write: GovernanceReadBeforeWriteSchema.optional(),
})
```

## Project Structure

New files to create:

```
src/hooks/read-before-write/
├── index.ts       # Hook factory: createReadBeforeWriteHook()
├── registry.ts    # FileReadRegistry singleton class
├── types.ts       # TypeScript interfaces
└── constants.ts   # Default config, hook name, messages
```

## Implementation Steps

### Phase 1: Core Infrastructure (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 1.1 | Create directory structure and types.ts | `src/hooks/read-before-write/types.ts` | 15min |
| 1.2 | Create constants.ts with defaults and messages | `src/hooks/read-before-write/constants.ts` | 15min |
| 1.3 | Implement FileReadRegistry singleton | `src/hooks/read-before-write/registry.ts` | 45min |
| 1.4 | Add schema to config | `src/config/schema.ts` | 15min |

**Phase 1 Details:**

**1.1 types.ts**
- Define `FileReadEntry`, `ReadBeforeWriteConfig`, `EnforcementResult`
- Export all interfaces

**1.2 constants.ts**
- `HOOK_NAME = "read-before-write"`
- `DEFAULT_CONFIG` with spec defaults
- `ERROR_MESSAGES.blocked()` and `WARNING_MESSAGES.noRead()`
- `MAX_TRACKED_FILES = 10000` (per NFR-1)

**1.3 registry.ts (FileReadRegistry with LRU Cache)**
- Singleton pattern matching `conflict-detector/registry.ts`
- `Map<sessionId, Map<normalizedPath, timestamp>>` structure
- LRU semantics using JavaScript Map's insertion-order guarantee:
  - `map.keys().next().value` returns oldest entry
  - Delete + re-insert moves entry to end (most recently used)
  - O(1) lookup, O(1) insertion, O(1) eviction
- Methods: `recordRead`, `hasRead`, `clearSession`, `getStats`, `reset`
- Automatic LRU eviction when exceeding `MAX_TRACKED_FILES`

**1.4 schema.ts**
- Add `GovernanceReadBeforeWriteSchema`
- Update `GovernanceConfigSchema`
- Export new type

### Phase 2: Hook Implementation (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Implement tool.execute.before handler (read tracking + enforcement) | `src/hooks/read-before-write/index.ts` | 45min |
| 2.2 | Implement multiedit handling | `src/hooks/read-before-write/index.ts` | 30min |
| 2.3 | Implement event handler (session cleanup) | `src/hooks/read-before-write/index.ts` | 15min |

**Phase 2 Details:**

**2.1 tool.execute.before (combined tracking + enforcement)**

SDK Constraint: `tool.execute.after` does NOT have access to `output.args` (only `title`, `output`, `metadata`). Therefore, BOTH read tracking AND enforcement happen in `tool.execute.before`.

```typescript
"tool.execute.before": async (input, output) => {
  // Guard: missing sessionID (per FR-6)
  if (!input.sessionID) {
    log("[read-before-write] Warning: Missing sessionID, skipping enforcement");
    return;
  }
  
  const toolLower = input.tool.toLowerCase();
  
  // TRACKING: Record reads
  if (toolLower === "read") {
    const filePath = output.args.filePath ?? output.args.file_path ?? output.args.path;
    if (filePath && typeof filePath === "string") {
      registry.recordRead(input.sessionID, path.resolve(filePath));
    }
    return; // Read tracking done, exit early
  }
  
  // TRACKING: Record writes to NEW files as "read" (per DD-8)
  // This enables create-then-edit workflows without blocking
  if (toolLower === "write") {
    const filePath = output.args.filePath ?? output.args.file_path;
    if (filePath && typeof filePath === "string") {
      const absolutePath = path.resolve(filePath);
      // Only track if file doesn't exist (new file creation)
      if (!existsSync(absolutePath)) {
        registry.recordRead(input.sessionID, absolutePath);
      }
    }
  }
  
  // ENFORCEMENT: Check write/edit/multiedit
  if (!["write", "edit", "multiedit"].includes(toolLower)) return;
  
  // Check tool exemption first (fast path)
  if (config.exempt_tools.includes(input.tool)) return;
  
  // Handle single file (write/edit)
  if (toolLower === "write" || toolLower === "edit") {
    const filePath = output.args.filePath ?? output.args.file_path;
    if (!filePath) return;
    enforceReadBeforeWrite(input.sessionID, filePath as string);
  }
  
  // Handle multiedit (see 2.2)
  if (toolLower === "multiedit") {
    handleMultiedit(input.sessionID, output.args);
  }
}

function enforceReadBeforeWrite(sessionID: string, filePath: string): void {
  // Check path exemption
  if (isPathExempt(filePath, config.exempt_paths)) return;
  
  // Check file exists (new files allowed)
  const absolutePath = path.resolve(filePath);
  if (!existsSync(absolutePath)) return;
  
  // Enforce read-before-write
  if (!registry.hasRead(sessionID, absolutePath)) {
    const message = ERROR_MESSAGES.blocked(filePath);
    if (config.mode === "block") {
      throw new Error(message);
    } else if (config.mode === "warn") {
      log(WARNING_MESSAGES.noRead(filePath));
    }
  }
}
```

**2.2 Multiedit Handling**

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

**2.3 Event handler**
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

### Phase 3: Integration (45min)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Export from hooks/index.ts | `src/hooks/index.ts` | 5min |
| 3.2 | Add HookName to schema.ts enum | `src/config/schema.ts` | 5min |
| 3.3 | Wire up in main plugin | `src/index.ts` | 20min |
| 3.4 | Update README documentation | `README.md` | 15min |

**Phase 3 Details:**

**3.1 hooks/index.ts**
```typescript
export { createReadBeforeWriteHook } from "./read-before-write";
export type { ReadBeforeWriteConfig } from "./read-before-write";
```

**3.2 schema.ts**
Add `"read-before-write"` to `HookNameSchema` enum.

**3.3 index.ts integration**
- Import `createReadBeforeWriteHook`
- Create hook instance with config
- Add to `tool.execute.before` handler (run BEFORE conflict-detector to prevent lock acquisition on blocked operations)
- Add event handler for session cleanup
- Note: No `tool.execute.after` handler needed (SDK constraint - args not available in after hook)

**3.4 README updates**
- Add to Governance section
- Document configuration options
- Add to Governance Hooks table

### Phase 4: Testing & Validation (1h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Manual testing: basic flow | - | 20min |
| 4.2 | Manual testing: exemptions | - | 15min |
| 4.3 | Manual testing: new file creation | - | 10min |
| 4.4 | Manual testing: session cleanup | - | 15min |

## Dependencies

### Internal (This Repo)

| Dependency | Status | Notes |
|------------|--------|-------|
| `conflict-detector/registry.ts` | Exists | Pattern reference for singleton |
| `governance-path-validator` | Exists | Pattern reference for path matching |
| `src/config/schema.ts` | Exists | Add new schema |
| `src/hooks/index.ts` | Exists | Export hook |
| `src/index.ts` | Exists | Wire hook |
| `src/shared/logger.ts` | Exists | `log()` function |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| `node:fs` | Built-in | `existsSync` for file existence check |
| `node:path` | Built-in | `path.resolve` for normalization |
| `minimatch` | Installed | Glob pattern matching for exempt_paths |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Read tracked even if read operation fails | Low | Low | Acceptable trade-off for SDK constraint (args only in before hook) |
| Memory growth from long sessions | Medium | Medium | MAX_TRACKED_FILES limit with LRU eviction using Map insertion-order |
| Path normalization edge cases | Medium | Medium | Use `path.resolve()`, handle undefined gracefully |
| Glob matching performance | Low | Low | Cache compiled patterns, `minimatch` is efficient |
| False positives blocking legitimate workflows | Medium | High | Comprehensive exemption system, warn mode default for initial rollout |

## Testing Strategy

**Manual Testing Checklist:**

1. **Basic Flow**
   - [ ] Read a file, then edit it → Should succeed
   - [ ] Edit a file without reading → Should block/warn based on mode

2. **Exemptions**
   - [ ] Use `lsp_rename` without reading → Should succeed (tool exempt)
   - [ ] Edit file in `dist/` → Should succeed (path exempt)
   - [ ] Use `memory_write` → Should succeed (tool exempt)

3. **New File Creation**
   - [ ] Write to non-existent file → Should succeed
   - [ ] Create file, then edit immediately → Should work

4. **Configuration**
   - [ ] Set `mode: "warn"` → Should log warning but allow
   - [ ] Set `enabled: false` → Should skip all checks
   - [ ] Add custom tool to `exempt_tools` → Should bypass

5. **Session Lifecycle**
   - [ ] Delete session → Registry should clear session data
   - [ ] Compact session → Registry should clear session data

## Success Metrics

| Metric | Target |
|--------|--------|
| Failed edit reduction | 95% reduction in "must read first" errors |
| Performance impact | <5ms latency per enforcement check |
| Memory bounded | Max 10,000 files tracked per session |
| False positive rate | <1% legitimate operations blocked |

## Time Summary

| Phase | Estimate |
|-------|----------|
| Phase 1: Core Infrastructure | 1.5h |
| Phase 2: Hook Implementation | 1.5h |
| Phase 3: Integration | 0.75h |
| Phase 4: Testing & Validation | 1h |
| **Total** | **4.75h** |

## Next Steps

After plan approval:
1. Run `/tasks` to create task breakdown
2. Run `/implement` to start Phase 1
