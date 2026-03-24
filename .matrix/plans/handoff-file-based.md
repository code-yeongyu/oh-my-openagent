# File-Based Handoff Mechanism

## TL;DR

> **Quick Summary**: Modify `/handoff` to write context to `.matrix/handoff.md` instead of outputting text, and create a `handoff-injector` hook that auto-detects and injects this file on new session startup.
> 
> **Deliverables**:
> - Modified handoff template (prompt-only change)
> - New `handoff-injector` hook with storage, tests
> - Hook registration (schema, session hooks, event dispatch)
> - `ContextSourceType` extension
> 
> **Estimated Effort**: Medium (12 files, 6 new + 6 modified)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (types) → Task 3 (hook) → Task 6 (registration)

---

## Context

### Original Request
Implement a file-based handoff mechanism for the Matrixx OpenCode plugin. The `/handoff` command currently outputs a context summary as plain text for copy-paste. Modify it to write to `.matrix/handoff.md`, and create a hook that auto-injects this file into the first message of a new session.

### Interview Summary
**Key Discussions**:
- Injection via `contextCollector.register()` on `session.created` — content consumed on first `messages.transform`
- File cleanup via rename to `.matrix/handoff.consumed.md` (not deletion) for debug ability
- Core hook tier (session bootstrap, not continuation logic)
- Template change is prompt-only — agent uses Write tool to create the file
- `"handoff-injector"` added to `ContextSourceType` for traceability over generic `"custom"`
- Test effort focused on hook logic + storage; template wording tests skipped (low risk)

**Research Findings**:
- `ContextCollector.register()` stores by sessionID, consumed on next `messages.transform` via synthetic parts
- `session.created` fires with `props.info = { id?, title?, parentID? }`; main session = `!parentID`
- All existing hooks handle `session.created` internally by checking `event.type` — dispatch function sends ALL events to ALL hooks
- `contextCollector` is a singleton (ESM module caching); same instance shared across all hooks
- `renameSync` is atomic on Linux within same filesystem

### Seraph Review
**Identified Gaps** (addressed):
- Empty/whitespace file content → hook must check `content.trim()`, rename but skip registration
- `sessionInfo?.id` undefined → early return guard before any file I/O
- `renameSync` failure after successful `register()` → still add sessionID to idempotency Set
- `readFileSync` without encoding → must use `'utf-8'` explicitly
- Concurrent session race (two instances read same file) → try/catch on readFileSync, treat ENOENT as "already consumed"
- Partial/malformed handoff file → inject as-is (agent's responsibility to write valid content)
- Existing `.matrix/handoff.consumed.md` → overwritten by renameSync (correct behavior)

**Seraph directive G1 (dispatch location) overridden**: Seraph suggested placing dispatch inside the `session.created` block in `event.ts`. This contradicts the established pattern — ALL hooks (`directoryAgentsInjector`, `rulesInjector`, `autoUpdateChecker`, `thinkMode`, etc.) are dispatched via `dispatchToHooks()` and filter for `session.created` internally. Following the established codebase pattern.

---

## Work Objectives

### Core Objective
Enable seamless session continuation by automating the handoff context transfer through a file-based mechanism, eliminating manual copy-paste.

### Concrete Deliverables
- Modified `src/features/builtin-commands/templates/handoff.ts` — agent writes to `.matrix/handoff.md`
- New `src/hooks/handoff-injector/` module — constants, storage, hook, tests
- Hook registration across schema, session hooks, event dispatch, barrel export

### Definition of Done
- [ ] `bun test src/hooks/handoff-injector/` → all tests pass
- [ ] `bun run typecheck` → zero errors
- [ ] Handoff template instructs agent to write `.matrix/handoff.md` (not output text)
- [ ] Hook auto-injects handoff content on main session startup
- [ ] Hook renames file to `.consumed.md` after injection
- [ ] Hook gracefully handles: missing file, empty file, undefined sessionID, subagent sessions

### Must Have
- TDD: tests written before implementation
- `contextCollector` passed as parameter (not imported directly) for testability
- All file I/O wrapped in try/catch — hook must never crash the session
- Idempotency: in-memory Set prevents double-injection per session
- BDD comments in tests (`//#given`, `//#when`, `//#then`)

### Must NOT Have (Guardrails)
- Do NOT modify Phase 1 or Phase 2 of the handoff template
- Do NOT call `contextCollector.consume()` or `contextCollector.clear()` from the hook
- Do NOT add handoff history, file versioning, or rotation
- Do NOT add `.matrix/handoff.md` to `.gitignore` (separate concern)
- Do NOT add a config option to `MatrixxConfigSchema` — the hook is togglable via `disabled_hooks` only
- Do NOT create integration tests requiring a live OpenCode session
- Do NOT use `as any` or `@ts-ignore`

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks are verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES — `bun:test` is configured and used across 176 test files
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: `bun:test`

### TDD Structure

Each TODO follows RED-GREEN-REFACTOR:

**Task Structure:**
1. **RED**: Write failing test first
   - Test command: `bun test src/hooks/handoff-injector/`
   - Expected: FAIL (test exists, implementation doesn't)
2. **GREEN**: Implement minimum code to pass
   - Command: `bun test src/hooks/handoff-injector/`
   - Expected: PASS
3. **REFACTOR**: Clean up while keeping green
   - Command: `bun test src/hooks/handoff-injector/`
   - Expected: PASS (still)

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| TypeScript modules | Bash (`bun run typecheck`) | Zero errors |
| Tests | Bash (`bun test <path>`) | All pass |
| Template text | Bash (grep) | Expected strings present, old strings absent |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundational types + independent template):
├── Task 1: ContextSourceType + handoff constants [no dependencies]
└── Task 2: Handoff template modification [no dependencies]

Wave 2 (After Wave 1 — implementation + tests):
├── Task 3: Storage module + tests [depends: 1]
└── Task 4: Hook module + tests [depends: 1, 3]

Wave 3 (After Wave 2 — registration + wiring):
└── Task 5: Hook registration (schema + session hooks + event dispatch + barrel) [depends: 4]

Critical Path: Task 1 → Task 3 → Task 4 → Task 5
Parallel Speedup: ~35% faster than sequential
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 3, 4 | 2 |
| 2 | None | None | 1 |
| 3 | 1 | 4 | 2 |
| 4 | 1, 3 | 5 | None |
| 5 | 4 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2 | Two parallel `bullet-time` tasks |
| 2 | 3, then 4 | Sequential `source` tasks (TDD) |
| 3 | 5 | Single `bullet-time` task |

---

## TODOs

- [ ] 1. Add `"handoff-injector"` to ContextSourceType + create handoff-injector constants

  **What to do**:
  - In `src/features/context-injector/types.ts`, add `"handoff-injector"` to the `ContextSourceType` union (line 5-10)
  - Create `src/hooks/handoff-injector/constants.ts` with:
    ```typescript
    import { MISSION_DIR } from "../../features/mission-state/constants"
    
    export const HANDOFF_FILENAME = "handoff.md"
    export const HANDOFF_CONSUMED_FILENAME = "handoff.consumed.md"
    export const HANDOFF_FILE_PATH = `${MISSION_DIR}/${HANDOFF_FILENAME}`
    export const HANDOFF_CONSUMED_FILE_PATH = `${MISSION_DIR}/${HANDOFF_CONSUMED_FILENAME}`
    ```

  **Must NOT do**:
  - Do NOT add any other source types
  - Do NOT modify the `ContextEntry`, `RegisterContextOptions`, or other types in the file

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Two small file changes (one-line addition + new 8-line file), trivial scope
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/features/mission-state/constants.ts:1-14` — Existing constants pattern using `MISSION_DIR` for `.matrix/` paths; import and reuse `MISSION_DIR` from here
  - `src/hooks/directory-agents-injector/constants.ts:1-7` — Existing hook constants file pattern (imports, exports, naming convention)

  **API/Type References**:
  - `src/features/context-injector/types.ts:5-10` — The `ContextSourceType` union where `"handoff-injector"` must be added as a new member

  **Acceptance Criteria**:

  - [ ] `src/features/context-injector/types.ts` contains `"handoff-injector"` in ContextSourceType union
  - [ ] `src/hooks/handoff-injector/constants.ts` exists with all 4 constants exported
  - [ ] Constants import `MISSION_DIR` from `../../features/mission-state/constants`
  - [ ] `bun run typecheck` → zero errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: ContextSourceType includes handoff-injector
    Tool: Bash (grep)
    Steps:
      1. grep "handoff-injector" src/features/context-injector/types.ts
      2. Assert: match found in ContextSourceType union
    Expected Result: "handoff-injector" appears in source type union
    Evidence: grep output captured

  Scenario: Constants file exports all required values
    Tool: Bash (bun)
    Steps:
      1. bun -e "const c = require('./src/hooks/handoff-injector/constants'); console.log(Object.keys(c).sort().join(','))"
      2. Assert: output contains HANDOFF_CONSUMED_FILE_PATH,HANDOFF_CONSUMED_FILENAME,HANDOFF_FILENAME,HANDOFF_FILE_PATH
    Expected Result: All 4 constants exported
    Evidence: Console output captured

  Scenario: TypeScript compiles cleanly
    Tool: Bash
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: No type errors
    Evidence: Command output
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(handoff): add handoff-injector source type and constants`
  - Files: `src/features/context-injector/types.ts`, `src/hooks/handoff-injector/constants.ts`
  - Pre-commit: `bun run typecheck`

---

- [ ] 2. Modify handoff template (Phase 3 + Phase 4)

  **What to do**:
  - In `src/features/builtin-commands/templates/handoff.ts`, modify **PHASE 3** and **PHASE 4** only:
  
  **PHASE 3 change** — After the handoff summary format block (around line 76-142), replace the instruction that says "Generate a handoff summary using this exact format" to add: after generating the summary in that format, **write it to `.matrix/handoff.md`** using the Write tool. Keep the same format specification — only change the delivery mechanism from "output as text" to "write to file".
  
  Specifically, change the Phase 3 header section to instruct:
  ```
  Write the handoff summary to `.matrix/handoff.md` using the Write tool.
  Use this exact format:
  ```
  
  **PHASE 4 change** — Replace the entire Phase 4 content (lines 145-159). Currently it says "Press 'n'... Paste the HANDOFF CONTEXT...". Replace with:
  ```
  After writing the summary, inform the user:
  
  ---
  
  HANDOFF COMPLETE:
  
  Context saved to .matrix/handoff.md
  
  To continue in a new session:
  1. Press 'n' in OpenCode TUI to open a new session, or run 'opencode' in a new terminal
  2. Your context will be loaded automatically — no copy-paste needed
  3. Start with your next task: "Continue from where I left off. [Your next task]"
  
  ---
  ```

  **Must NOT do**:
  - Do NOT modify Phase 0 (validate request)
  - Do NOT modify Phase 1 (gather programmatic context)
  - Do NOT modify Phase 2 (extract context)
  - Do NOT modify the IMPORTANT CONSTRAINTS section (except updating the constraint about providing a self-contained summary — it should still be self-contained in the file)
  - Do NOT change the handoff summary format structure itself (the HANDOFF CONTEXT / USER REQUESTS / GOAL / etc. sections)

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Text-only change in a template string, no logic involved
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/features/builtin-commands/templates/handoff.ts:1-178` — The COMPLETE current template. Phase 3 starts at line 74, Phase 4 starts at line 145. Modify ONLY these two sections.

  **Documentation References**:
  - `src/features/builtin-commands/commands.ts:82-97` — How the template is embedded in the command definition (shows `<command-instruction>` wrapping). No changes needed here, but understand the context.

  **Acceptance Criteria**:

  - [ ] Phase 3 instructs agent to write to `.matrix/handoff.md` using Write tool
  - [ ] Phase 4 tells user context will auto-load (no copy-paste instructions)
  - [ ] Phase 0, 1, 2, and IMPORTANT CONSTRAINTS are unchanged (except the self-contained constraint update)
  - [ ] Handoff summary format structure (HANDOFF CONTEXT / USER REQUESTS / GOAL / etc.) is unchanged
  - [ ] Template still exports `HANDOFF_TEMPLATE` as a string constant
  - [ ] `bun run typecheck` → zero errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Template references .matrix/handoff.md
    Tool: Bash (grep)
    Steps:
      1. grep -c ".matrix/handoff.md" src/features/builtin-commands/templates/handoff.ts
      2. Assert: count >= 1
    Expected Result: File path appears in template
    Evidence: grep output

  Scenario: Template no longer contains copy-paste instructions
    Tool: Bash (grep)
    Steps:
      1. grep -c "Paste the HANDOFF CONTEXT" src/features/builtin-commands/templates/handoff.ts
      2. Assert: count is 0
    Expected Result: Old copy-paste text removed
    Evidence: grep output

  Scenario: Template contains auto-load messaging
    Tool: Bash (grep)
    Steps:
      1. grep -c "loaded automatically" src/features/builtin-commands/templates/handoff.ts
      2. Assert: count >= 1
    Expected Result: New auto-load messaging present
    Evidence: grep output

  Scenario: Phase 0, 1, 2 unchanged
    Tool: Bash (grep)
    Steps:
      1. grep "PHASE 0: VALIDATE REQUEST" src/features/builtin-commands/templates/handoff.ts
      2. grep "PHASE 1: GATHER PROGRAMMATIC CONTEXT" src/features/builtin-commands/templates/handoff.ts
      3. grep "PHASE 2: EXTRACT CONTEXT" src/features/builtin-commands/templates/handoff.ts
      4. Assert: all three found
    Expected Result: Phases 0-2 still present
    Evidence: grep outputs
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(handoff): instruct agent to write handoff context to file`
  - Files: `src/features/builtin-commands/templates/handoff.ts`
  - Pre-commit: `bun run typecheck`

---

- [ ] 3. Create storage module with tests (TDD)

  **What to do**:
  
  **RED phase — Write tests first** in `src/hooks/handoff-injector/storage.test.ts`:
  - Test `handoffFileExists(directory)` → returns `true` when `.matrix/handoff.md` exists, `false` otherwise
  - Test `readHandoffFile(directory)` → returns file content as string when file exists, `null` when missing, `null` on read error
  - Test `archiveHandoffFile(directory)` → renames `.matrix/handoff.md` to `.matrix/handoff.consumed.md`, returns `true` on success, `false` on failure, overwrites existing `.consumed.md`
  - Test edge cases: empty file content returns empty string (not null), `.matrix/` dir doesn't exist returns null/false gracefully
  - Use temp directories (`tmpdir()` + `randomUUID()`) per test with `beforeEach`/`afterEach` cleanup
  - BDD comments: `//#given`, `//#when`, `//#then`
  
  **GREEN phase — Implement** `src/hooks/handoff-injector/storage.ts`:
  ```typescript
  import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs"
  import { join, dirname } from "node:path"
  import { HANDOFF_FILE_PATH, HANDOFF_CONSUMED_FILE_PATH } from "./constants"
  
  export function getHandoffFilePath(directory: string): string {
    return join(directory, HANDOFF_FILE_PATH)
  }
  
  export function getHandoffConsumedFilePath(directory: string): string {
    return join(directory, HANDOFF_CONSUMED_FILE_PATH)
  }
  
  export function handoffFileExists(directory: string): boolean {
    return existsSync(getHandoffFilePath(directory))
  }
  
  export function readHandoffFile(directory: string): string | null {
    const filePath = getHandoffFilePath(directory)
    try {
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, "utf-8")
    } catch {
      return null
    }
  }
  
  export function archiveHandoffFile(directory: string): boolean {
    try {
      renameSync(
        getHandoffFilePath(directory),
        getHandoffConsumedFilePath(directory)
      )
      return true
    } catch {
      return false
    }
  }
  ```

  **Must NOT do**:
  - Do NOT add write functionality (the agent writes the file, not the plugin)
  - Do NOT add file rotation or versioning
  - Do NOT use `as any` or `@ts-ignore`

  **Recommended Agent Profile**:
  - **Category**: `source`
    - Reason: TDD implementation with logic — needs RED-GREEN-REFACTOR discipline
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential within Wave 2 — Task 4 depends on this)
  - **Parallel Group**: Wave 2 (before Task 4)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1 (needs constants)

  **References**:

  **Pattern References**:
  - `src/features/mission-state/storage.ts:1-163` — File I/O pattern to follow: `existsSync` + `readFileSync("utf-8")` + try/catch returning null/false. Use this as the structural model for all functions.
  - `src/hooks/directory-agents-injector/storage.ts:1-9` — Simpler storage pattern showing how hook storage modules export utility functions.

  **API/Type References**:
  - `src/hooks/handoff-injector/constants.ts` — Import `HANDOFF_FILE_PATH` and `HANDOFF_CONSUMED_FILE_PATH` from here (created in Task 1)

  **Test References**:
  - `src/features/mission-state/storage.test.ts` — Test pattern for file-based storage: uses `tmpdir()` + `randomUUID()` temp dirs, `beforeEach`/`afterEach` cleanup, BDD comments
  - `src/hooks/start-work/index.test.ts:14-42` — Test setup pattern: `createMockPluginInput()`, temp dir creation/cleanup with `mkdirSync`/`rmSync`

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file: `src/hooks/handoff-injector/storage.test.ts`
  - [ ] Tests cover: exists check, read success, read missing, read error, archive success, archive failure, archive overwrites existing consumed file, empty file returns empty string
  - [ ] `bun test src/hooks/handoff-injector/storage.test.ts` → PASS (all tests, 0 failures)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Storage tests pass with full coverage
    Tool: Bash
    Preconditions: Task 1 completed (constants exist)
    Steps:
      1. bun test src/hooks/handoff-injector/storage.test.ts
      2. Assert: exit code 0
      3. Assert: output shows all tests passing
    Expected Result: All storage tests pass
    Evidence: Test output captured

  Scenario: TypeScript compiles cleanly
    Tool: Bash
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: No type errors
    Evidence: Command output
  ```

  **Commit**: YES
  - Message: `feat(handoff-injector): add file storage module with tests`
  - Files: `src/hooks/handoff-injector/storage.ts`, `src/hooks/handoff-injector/storage.test.ts`
  - Pre-commit: `bun test src/hooks/handoff-injector/storage.test.ts`

---

- [ ] 4. Create hook module with tests (TDD)

  **What to do**:
  
  **RED phase — Write tests first** in `src/hooks/handoff-injector/hook.test.ts`:

  Test cases (each with BDD comments):
  1. **Registers context when handoff.md exists** — Create temp dir with `.matrix/handoff.md` containing valid content. Fire `session.created` event with valid `sessionInfo.id` and no `parentID`. Assert `contextCollector.register()` was called with sessionID, source `"handoff-injector"`, priority `"critical"`, and the file content.
  2. **Renames file to .consumed.md after registration** — After successful injection, assert `.matrix/handoff.md` is gone and `.matrix/handoff.consumed.md` exists with same content.
  3. **Skips subagent sessions (parentID present)** — Fire event with `parentID` set. Assert no file I/O and no `register()` call.
  4. **Skips when sessionInfo.id is undefined** — Fire event with undefined id. Assert no file I/O.
  5. **Skips when sessionInfo is undefined** — Fire event with no `info` property. Assert no crash.
  6. **Skips gracefully when handoff.md does not exist** — No file present. Assert no error, no `register()` call.
  7. **Skips when file content is empty/whitespace** — Create file with `"   \n  "`. Assert file is renamed (archived) but `register()` is NOT called.
  8. **Is idempotent — second session.created for same session is a no-op** — Fire event twice with same sessionID. Assert `register()` called only once.
  9. **Ignores non-session.created events** — Fire `session.deleted`, `session.idle`, etc. Assert no action.
  10. **Handles readFileSync failure gracefully (ENOENT race)** — File disappears between `existsSync` and `readFileSync`. Assert no crash, no `register()`.
  11. **Still adds to idempotency Set if renameSync fails** — Mock `renameSync` to throw. Assert `register()` was called and session is tracked (second event is no-op).

  Test setup:
  - Create a mock `ContextCollector` (or use a real `new ContextCollector()` instance for integration-style tests)
  - Use temp directories with `beforeEach`/`afterEach` cleanup
  - Mock `PluginInput` with `{ directory: testDir, client: {} }`

  **GREEN phase — Implement** `src/hooks/handoff-injector/hook.ts`:
  ```typescript
  import type { PluginInput } from "@opencode-ai/plugin"
  import type { ContextCollector } from "../../features/context-injector"
  import { log } from "../../shared/logger"
  import { handoffFileExists, readHandoffFile, archiveHandoffFile } from "./storage"
  
  export function createHandoffInjectorHook(
    ctx: PluginInput,
    contextCollector: ContextCollector
  ) {
    const injectedSessions = new Set<string>()
    
    return {
      event: async (input: {
        event: { type: string; properties?: Record<string, unknown> }
      }) => {
        if (input.event.type !== "session.created") return
        
        const props = input.event.properties as Record<string, unknown> | undefined
        const sessionInfo = props?.info as
          | { id?: string; parentID?: string }
          | undefined
        
        // Skip: no session ID
        if (!sessionInfo?.id) return
        
        // Skip: subagent session
        if (sessionInfo.parentID) return
        
        // Skip: already injected this session
        if (injectedSessions.has(sessionInfo.id)) return
        
        // Skip: no handoff file
        if (!handoffFileExists(ctx.directory)) return
        
        const content = readHandoffFile(ctx.directory)
        if (content === null) return
        
        // Skip empty/whitespace — archive but don't inject
        if (!content.trim()) {
          archiveHandoffFile(ctx.directory)
          injectedSessions.add(sessionInfo.id)
          return
        }
        
        // Register context for injection on first messages.transform
        contextCollector.register(sessionInfo.id, {
          id: "handoff-context",
          source: "handoff-injector",
          content,
          priority: "critical",
        })
        
        log("[handoff-injector] Registered handoff context for injection", {
          sessionID: sessionInfo.id,
          contentLength: content.length,
        })
        
        // Archive the file — even if this fails, track the session
        const archived = archiveHandoffFile(ctx.directory)
        injectedSessions.add(sessionInfo.id)
        
        if (!archived) {
          log("[handoff-injector] Warning: failed to archive handoff file", {
            sessionID: sessionInfo.id,
          })
        }
      },
    }
  }
  ```
  
  Also create `src/hooks/handoff-injector/index.ts`:
  ```typescript
  export { createHandoffInjectorHook } from "./hook"
  ```

  **Must NOT do**:
  - Do NOT call `contextCollector.consume()` or `contextCollector.clear()`
  - Do NOT import `contextCollector` singleton directly — receive it as a parameter
  - Do NOT add config options or schema changes (that's Task 5)
  - Do NOT add file size validation or truncation

  **Recommended Agent Profile**:
  - **Category**: `source`
    - Reason: Core TDD task with event-driven logic, edge cases, and mock setup — needs careful RED-GREEN-REFACTOR discipline
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (types), Task 3 (storage module)

  **References**:

  **Pattern References**:
  - `src/hooks/directory-agents-injector/hook.ts:1-85` — Hook factory pattern: `createXXXHook(ctx)` returning object with `event` handler. Shows how to check `event.type`, extract `sessionInfo`, use per-session tracking (`sessionCaches` Map). Follow this structure.
  - `src/hooks/auto-update-checker/hook.ts:30` — Pattern for internal `session.created` filtering: `if (event.type !== "session.created") return`
  - `src/hooks/session-notification.ts:61` — Another example of internal `session.created` check within an event handler

  **API/Type References**:
  - `src/features/context-injector/collector.ts:20-38` — `ContextCollector.register()` signature: `register(sessionID: string, options: RegisterContextOptions)`. Options require `id`, `source`, `content`, optional `priority`.
  - `src/features/context-injector/types.ts:39-50` — `RegisterContextOptions` interface: `{ id: string, source: ContextSourceType, content: string, priority?: ContextPriority }`
  - `src/plugin/event.ts:95-98` — How `session.created` events are structured: `props.info = { id?, title?, parentID? }`

  **Test References**:
  - `src/hooks/start-work/index.test.ts:1-406` — Complete TDD test file for a session hook: mock `PluginInput` setup, temp dir lifecycle, BDD comments, testing `chat.message` handler with various inputs. Adapt this pattern for event handler testing.
  - `src/hooks/keyword-detector/index.test.ts:38-39` — Pattern for testing with `ContextCollector`: creates `new ContextCollector()` instance per test

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file: `src/hooks/handoff-injector/hook.test.ts`
  - [ ] Tests cover all 11 test cases listed above
  - [ ] `bun test src/hooks/handoff-injector/hook.test.ts` → PASS (11 tests, 0 failures)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All hook tests pass
    Tool: Bash
    Preconditions: Tasks 1, 3 completed
    Steps:
      1. bun test src/hooks/handoff-injector/hook.test.ts
      2. Assert: exit code 0
      3. Assert: 11 tests, 0 failures
    Expected Result: All hook logic tests pass
    Evidence: Test output captured

  Scenario: All handoff-injector tests pass together
    Tool: Bash
    Steps:
      1. bun test src/hooks/handoff-injector/
      2. Assert: exit code 0
    Expected Result: Storage + hook tests all pass
    Evidence: Test output captured

  Scenario: TypeScript compiles cleanly
    Tool: Bash
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: No type errors
    Evidence: Command output
  ```

  **Commit**: YES
  - Message: `feat(handoff-injector): add hook with session.created handler and tests`
  - Files: `src/hooks/handoff-injector/hook.ts`, `src/hooks/handoff-injector/hook.test.ts`, `src/hooks/handoff-injector/index.ts`
  - Pre-commit: `bun test src/hooks/handoff-injector/`

---

- [ ] 5. Register hook: schema + session hooks + event dispatch + barrel export

  **What to do**:

  **5a. Add to HookNameSchema** — `src/config/schema/hooks.ts`:
  - Add `"handoff-injector"` to the `z.enum([...])` array (after `"env-file-write-guard"` on line 50, before the closing `]`)

  **5b. Create hook in create-session-hooks.ts** — `src/plugin/hooks/create-session-hooks.ts`:
  - Add import: `import { createHandoffInjectorHook } from "../../hooks/handoff-injector"`
  - Add import: `import { contextCollector } from "../../features/context-injector"` (new dependency for this tier)
  - Add to `SessionHooks` type (line 33): `handoffInjector: ReturnType<typeof createHandoffInjectorHook> | null`
  - Add creation inside `createSessionHooks()`:
    ```typescript
    const handoffInjector = isHookEnabled("handoff-injector")
      ? safeHook("handoff-injector", () => createHandoffInjectorHook(ctx, contextCollector))
      : null
    ```
  - Add `handoffInjector` to the return object

  **5c. Wire in event dispatch** — `src/plugin/event.ts`:
  - Add one line inside `dispatchToHooks` function (after the `atlasHook` line 51, before the closing `}`):
    ```typescript
    await Promise.resolve(hooks.handoffInjector?.event?.(input))
    ```

  **5d. Add barrel export** — `src/hooks/index.ts`:
  - Add: `export { createHandoffInjectorHook } from "./handoff-injector"`

  **Must NOT do**:
  - Do NOT add to `MatrixxConfigSchema` (no config option — disable via `disabled_hooks` only)
  - Do NOT add to `create-continuation-hooks.ts` (this is a core session hook)
  - Do NOT add to the `session.created` block in event.ts — add to `dispatchToHooks` following the established pattern

  **Recommended Agent Profile**:
  - **Category**: `bullet-time`
    - Reason: Four small, precise edits across existing files. Each change is 1-3 lines. No logic involved.
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (final integration task)
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 4 (hook must exist before registering)

  **References**:

  **Pattern References**:
  - `src/config/schema/hooks.ts:3-51` — Full `HookNameSchema` enum. Add `"handoff-injector"` as new member.
  - `src/plugin/hooks/create-session-hooks.ts:1-178` — Full session hooks creation. Follow the `isHookEnabled → safeHook → factory` pattern used by `startWork` (lines 137-139) and `autoUpdateChecker` (lines 100-107). Add `contextCollector` import from `../../features/context-injector`.
  - `src/plugin/event.ts:32-52` — The `dispatchToHooks` function. Add new line following `atlasHook` dispatch pattern.
  - `src/hooks/index.ts:1-49` — Barrel exports. Add new line following existing `export { createXXX } from "./xxx"` pattern.

  **API/Type References**:
  - `src/hooks/handoff-injector/index.ts` — The barrel export that will be imported (created in Task 4)
  - `src/features/context-injector/index.ts:1` — Exports `contextCollector` singleton for import into create-session-hooks.ts

  **Acceptance Criteria**:

  - [ ] `"handoff-injector"` appears in `HookNameSchema` in `src/config/schema/hooks.ts`
  - [ ] `createHandoffInjectorHook` imported and used in `src/plugin/hooks/create-session-hooks.ts`
  - [ ] `contextCollector` imported in `create-session-hooks.ts` from context-injector
  - [ ] `handoffInjector` field added to `SessionHooks` type
  - [ ] `handoffInjector` added to return object of `createSessionHooks()`
  - [ ] Dispatch line added to `dispatchToHooks` in `src/plugin/event.ts`
  - [ ] Barrel export added to `src/hooks/index.ts`
  - [ ] `bun run typecheck` → zero errors
  - [ ] `bun test src/hooks/handoff-injector/` → all tests still pass (regression check)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Hook name registered in schema
    Tool: Bash (grep)
    Steps:
      1. grep "handoff-injector" src/config/schema/hooks.ts
      2. Assert: match found inside HookNameSchema enum
    Expected Result: Hook name is in schema
    Evidence: grep output

  Scenario: Hook created in session hooks
    Tool: Bash (grep)
    Steps:
      1. grep "handoffInjector" src/plugin/hooks/create-session-hooks.ts
      2. Assert: matches for import, creation, type, and return
    Expected Result: Hook fully wired in session hooks
    Evidence: grep output

  Scenario: Event dispatch wired
    Tool: Bash (grep)
    Steps:
      1. grep "handoffInjector" src/plugin/event.ts
      2. Assert: dispatch line found
    Expected Result: Hook dispatched in event handler
    Evidence: grep output

  Scenario: Barrel export added
    Tool: Bash (grep)
    Steps:
      1. grep "handoff-injector" src/hooks/index.ts
      2. Assert: export line found
    Expected Result: Hook exported from barrel
    Evidence: grep output

  Scenario: Full typecheck passes
    Tool: Bash
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: No type errors across entire codebase
    Evidence: Command output

  Scenario: All handoff-injector tests still pass (regression)
    Tool: Bash
    Steps:
      1. bun test src/hooks/handoff-injector/
      2. Assert: exit code 0
    Expected Result: No regressions from wiring changes
    Evidence: Test output

  Scenario: Full test suite passes
    Tool: Bash
    Steps:
      1. bun test
      2. Assert: exit code 0 (or known flaky tests only)
    Expected Result: No regressions across entire codebase
    Evidence: Test output
  ```

  **Commit**: YES
  - Message: `feat(handoff-injector): register hook in schema, session hooks, and event dispatch`
  - Files: `src/config/schema/hooks.ts`, `src/plugin/hooks/create-session-hooks.ts`, `src/plugin/event.ts`, `src/hooks/index.ts`
  - Pre-commit: `bun run typecheck && bun test src/hooks/handoff-injector/`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1+2 | `feat(handoff): add handoff-injector source type, constants, and file-write template` | `types.ts`, `constants.ts`, `handoff.ts` | `bun run typecheck` |
| 3 | `feat(handoff-injector): add file storage module with tests` | `storage.ts`, `storage.test.ts` | `bun test src/hooks/handoff-injector/storage.test.ts` |
| 4 | `feat(handoff-injector): add hook with session.created handler and tests` | `hook.ts`, `hook.test.ts`, `index.ts` | `bun test src/hooks/handoff-injector/` |
| 5 | `feat(handoff-injector): register hook in schema, session hooks, and event dispatch` | `hooks.ts`, `create-session-hooks.ts`, `event.ts`, `index.ts` | `bun run typecheck && bun test` |

---

## Success Criteria

### Verification Commands
```bash
# All handoff-injector tests pass
bun test src/hooks/handoff-injector/        # Expected: all pass

# TypeScript compiles
bun run typecheck                            # Expected: 0 errors

# Template updated correctly
grep ".matrix/handoff.md" src/features/builtin-commands/templates/handoff.ts  # Expected: match
grep -c "Paste the HANDOFF CONTEXT" src/features/builtin-commands/templates/handoff.ts  # Expected: 0

# Hook registered correctly
grep "handoff-injector" src/config/schema/hooks.ts     # Expected: match
grep "handoff-injector" src/features/context-injector/types.ts  # Expected: match
grep "handoffInjector" src/plugin/event.ts             # Expected: match

# Full test suite (regression)
bun test                                     # Expected: pass (modulo known flaky tests)
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All handoff-injector tests pass
- [ ] TypeScript compiles with zero errors
- [ ] Full test suite passes (no regressions)
- [ ] Template references `.matrix/handoff.md`, not copy-paste
- [ ] Hook registered in schema, session hooks, and event dispatch
