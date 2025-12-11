# Background Agent Implementation Work Plan

**Date**: 2025-12-11
**Branch**: `feature/background-agent`
**Based on**: `local-ignore/background-agent-analysis.md`

---

## User's Original Request

`local-ignore/` 안의 마크다운 문서(background-agent-analysis.md)를 작업계획서로 작성. 모든 내용을 지금 상황에 맞게 구현.

**Q&A**:
- Q1. 기존 `omo_task`와의 관계? → A: `background_task` 별도 추가 (공존)
- Q2. MVP 스코프? → A: 전부 구현 (분석서에 있는 모든 것)
- Q3. Agent 제한? → A: Task와 동일하게 모든 agent 허용, Background 기능 지원하는 확장된 형태

---

## Concrete Deliverables

| Deliverable | Location | Description |
|-------------|----------|-------------|
| BackgroundManager 클래스 | `src/features/background-agent/manager.ts` | Task state management, SDK client integration, event handling, persistence |
| BackgroundTask types | `src/features/background-agent/types.ts` | TypeScript interfaces for background task |
| Storage utilities | `src/features/background-agent/storage.ts` | Persistence layer with debounced writes |
| Feature barrel export | `src/features/background-agent/index.ts` | Module exports |
| 4 background tools | `src/tools/background-task/tools.ts` | background_task, background_status, background_result, background_cancel |
| Tool types | `src/tools/background-task/types.ts` | Tool argument interfaces |
| Tool constants | `src/tools/background-task/constants.ts` | Tool descriptions, allowed agents |
| Tool barrel export | `src/tools/background-task/index.ts` | Tool exports |
| Background notification hook | `src/hooks/background-notification/index.ts` | chat.message hook for completion notification |
| Notification types | `src/hooks/background-notification/types.ts` | Hook types |
| Main integration | `src/index.ts` | Integrate tools and hooks into plugin |
| Tools index update | `src/tools/index.ts` | Export background tools |
| Hooks index update | `src/hooks/index.ts` | Export background notification hook |

---

## Definition of Done

- [ ] `bun run typecheck` passes with no errors
- [ ] `bun run build` succeeds
- [ ] `background_task` tool launches async agent and returns immediately
- [ ] `background_status` tool shows task status (pending/running/completed/error/cancelled)
- [ ] `background_result` tool retrieves completed task output
- [ ] `background_cancel` tool cancels running task
- [ ] State persists to `.opencode/background-tasks.json`
- [ ] Completion notification injected via `chat.message` hook
- [ ] Event listener tracks task progress (tool calls count)
- [ ] Parent session close triggers cascade cleanup
- [ ] No new dependencies added (use existing zod, @opencode-ai/plugin)

---

## Must Have

- All 4 tools: `background_task`, `background_status`, `background_result`, `background_cancel`
- BackgroundManager with:
  - Task state machine: pending → running → completed/error/cancelled
  - SDK client integration via `promptAsync()`
  - Event handling for progress tracking
  - Notification queue for completed tasks
- Persistence layer:
  - `.opencode/background-tasks.json` storage
  - Debounced writes (500ms)
  - Restore on plugin init
- Notification system:
  - `chat.message` hook injection
  - Formatted completion messages
  - Clear notifications after delivery
- Progress tracking:
  - Tool calls count
  - Last tool name
  - Last update timestamp

---

## Must NOT Have

- No modification to existing `omo_task` code
- No new npm dependencies
- No test files (test framework not configured)
- No changes to `oh-my-opencode.json` schema
- No over-engineered retry/backoff logic
- No complex state machine beyond 5 states
- No excessive logging

---

## References

### MUST READ Before Starting

| File | What to understand | Key patterns |
|------|-------------------|--------------|
| `src/tools/omo-task/tools.ts` | Existing task tool pattern | `createOmoTask` factory, SDK client usage, session creation |
| `src/tools/omo-task/types.ts` | Type definition pattern | Interface naming, optional props |
| `src/tools/omo-task/constants.ts` | Constants pattern | ALLOWED_AGENTS, description template |
| `src/tools/index.ts` | Tool export pattern | Barrel exports, `builtinTools` object |
| `src/hooks/session-notification.ts` | Event handling pattern | Event types, session tracking |
| `src/index.ts:100-103` | chat.message hook integration | How hooks merge |
| `src/index.ts:162-264` | Event hook integration | Event type handling, session state |
| `src/features/claude-code-session-state/` | Session state pattern | State storage, getters/setters |
| `local-ignore/background-agent-analysis.md` | Full specification | All implementation details |

### Reference Files (Per-task)

| File | Search term | Purpose |
|------|-------------|---------|
| `src/tools/omo-task/tools.ts:62` | `client.session.prompt` | Change to `promptAsync` for background |
| `src/tools/omo-task/tools.ts:43-56` | `client.session.create` | Session creation with parentID |
| `src/hooks/session-notification.ts:153-199` | `event.type` | Event handling patterns |
| `src/index.ts:100-103` | `chat.message` | Hook integration point |

---

## Task Flow Diagram

```
Phase 1 (Core Infrastructure)
├── Task 1: Create types ─────────────────────┐
├── Task 2: Create BackgroundManager ─────────┤ Sequential (2 depends on 1)
└── Task 3: Create storage utilities ─────────┘ Parallel with 2

Phase 2 (Tools)
├── Task 4: Create tool types & constants ────┐
├── Task 5: Implement background_task ────────┤ Sequential (5 depends on 4, 2)
├── Task 6: Implement background_status ──────┤ Sequential (6 depends on 5)
├── Task 7: Implement background_result ──────┤ Parallel with 6
└── Task 8: Implement background_cancel ──────┘ Parallel with 6, 7

Phase 3 (Notification)
├── Task 9: Create notification hook ─────────┐
└── Task 10: Hook integration in manager ─────┘ Sequential (10 depends on 9)

Phase 4 (Integration)
├── Task 11: Update tools/index.ts ───────────┐
├── Task 12: Update hooks/index.ts ───────────┤ Parallel (all 3)
├── Task 13: Update main index.ts ────────────┘
└── Task 14: Final verification ──────────────  Sequential (depends on 11-13)
```

---

## 현재 진행 중인 작업

- ✅ **Task 11: Update tools/index.ts** - 완료
- ✅ **Task 12: Update hooks/index.ts** - 완료
- ✅ **Task 13: Update main index.ts** - 완료
- ✅ **Task 14: Final verification and cleanup** - 완료

🎉 **모든 14개 태스크 완료!** Background Agent 기능 구현 완료!

---

## Tasks

### Phase 1: Core Infrastructure

- [x] **1. Create background-agent types**

  **What to do**:
  - Create `src/features/background-agent/types.ts`
  - Define `BackgroundTask` interface with all fields from analysis doc
  - Define `BackgroundTaskStatus` type union
  - Define `LaunchInput` interface for manager.launch()
  - Define `TaskProgress` interface

  **Must NOT do**:
  - Do NOT add fields not in analysis document
  - Do NOT use `class` for data types (use `interface`)

  **Parallelizable**: NO (foundation for all other tasks)

  **MUST READ first**:
  - `src/tools/omo-task/types.ts` - type definition pattern
  - `local-ignore/background-agent-analysis.md:308-325` - BackgroundTask interface spec

  **Acceptance Criteria**:
  - [ ] `BackgroundTask` interface has: id, sessionID, parentSessionID, parentMessageID, description, agent, status, startedAt, completedAt?, result?, error?, progress?
  - [ ] `BackgroundTaskStatus` = "pending" | "running" | "completed" | "error" | "cancelled"
  - [ ] File exports all types
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 3)

---

- [x] **2. Create BackgroundManager class**

  **What to do**:
  - Create `src/features/background-agent/manager.ts`
  - Implement `BackgroundManager` class with:
    - `tasks: Map<string, BackgroundTask>`
    - `notifications: Map<string, BackgroundTask[]>` (pending notifications per session)
    - `client: OpencodeClient` (from ctx)
    - `storePath: string`
  - Implement methods:
    - `launch(input: LaunchInput): Promise<BackgroundTask>` - create session, store task, call promptAsync
    - `getTask(id: string): BackgroundTask | undefined`
    - `getTasksByParentSession(sessionID: string): BackgroundTask[]`
    - `findBySession(sessionID: string): BackgroundTask | undefined`
    - `handleEvent(event: Event): void` - track progress, detect completion
    - `markForNotification(task: BackgroundTask): void`
    - `getPendingNotifications(sessionID: string): BackgroundTask[]`
    - `clearNotifications(sessionID: string): void`
    - `persist(): Promise<void>` - debounced write
    - `restore(): Promise<void>` - load from disk

  **Must NOT do**:
  - Do NOT implement retry logic
  - Do NOT add constructor parameters beyond client and storePath
  - Do NOT call persist() synchronously (always debounce)

  **Parallelizable**: NO (depends on Task 1)

  **MUST READ first**:
  - `src/tools/omo-task/tools.ts:41-72` - SDK client session.create and prompt patterns
  - `local-ignore/background-agent-analysis.md:327-416` - BackgroundManager spec
  - `local-ignore/background-agent-analysis.md:759-823` - Session lifecycle & cleanup

  **References**:
  - `src/tools/omo-task/tools.ts:62` - change `prompt()` to `promptAsync()` for non-blocking
  - `src/hooks/session-notification.ts:109-120` - notification queue pattern

  **Acceptance Criteria**:
  - [ ] `launch()` creates child session with parentID, calls promptAsync, returns task with status "running"
  - [ ] `handleEvent()` updates task.progress on `message.part.updated`
  - [ ] `handleEvent()` marks task completed on `session.updated` with status "idle"
  - [ ] `handleEvent()` handles `session.deleted` for cleanup
  - [ ] Debounced persist (500ms delay)
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 3)

---

- [x] **3. Create storage utilities**

  **What to do**:
  - Create `src/features/background-agent/storage.ts`
  - Implement persistence helpers:
    - `saveToFile(path: string, tasks: BackgroundTask[]): Promise<void>`
    - `loadFromFile(path: string): Promise<BackgroundTask[]>`
  - Handle file not exists gracefully (return empty array)
  - Create `src/features/background-agent/index.ts` barrel export

  **Must NOT do**:
  - Do NOT use synchronous file operations
  - Do NOT throw on missing file

  **Parallelizable**: YES (with Task 2, but Task 2 depends on Task 1)

  **MUST READ first**:
  - `src/features/claude-code-session-state/state.ts` - existing state storage pattern

  **Acceptance Criteria**:
  - [ ] `saveToFile` writes JSON with 2-space indent
  - [ ] `loadFromFile` returns `[]` if file doesn't exist
  - [ ] `index.ts` exports BackgroundManager and all types
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(background-agent): add BackgroundManager with persistence layer`
  - **Files to stage**: `src/features/background-agent/`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
  - **Rollback trigger**: Type errors in BackgroundManager

---

### Phase 2: Tools Implementation

- [x] **4. Create background-task tool types and constants**

  **What to do**:
  - Create `src/tools/background-task/types.ts`:
    - `BackgroundTaskArgs` interface (description, prompt, agent, session_id?)
    - `BackgroundStatusArgs` interface (taskId?)
    - `BackgroundResultArgs` interface (taskId)
    - `BackgroundCancelArgs` interface (taskId)
  - Create `src/tools/background-task/constants.ts`:
    - `BACKGROUND_TASK_DESCRIPTION` - tool description from analysis doc
    - `BACKGROUND_STATUS_DESCRIPTION`
    - `BACKGROUND_RESULT_DESCRIPTION`
    - `BACKGROUND_CANCEL_DESCRIPTION`

  **Must NOT do**:
  - Do NOT restrict agents like omo_task does (allow all agents)
  - Do NOT copy ALLOWED_AGENTS pattern

  **Parallelizable**: NO (required by Task 5-8)

  **MUST READ first**:
  - `src/tools/omo-task/types.ts` - type pattern
  - `src/tools/omo-task/constants.ts` - constants pattern
  - `local-ignore/background-agent-analysis.md:651-740` - tool specs

  **Acceptance Criteria**:
  - [ ] All 4 Args interfaces defined
  - [ ] All 4 description constants match analysis doc
  - [ ] No agent restriction (unlike omo_task)
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 8)

---

- [x] **5. Implement background_task tool** ✅ 완료

  **What to do**:
  - Create `src/tools/background-task/tools.ts`
  - Implement `createBackgroundTask(manager: BackgroundManager)` factory
  - Tool should:
    - Accept description, prompt, agent args
    - Call `manager.launch()` to start background task
    - Return formatted success message with task ID, session ID, status
    - Handle errors gracefully

  **Must NOT do**:
  - Do NOT block/await for task completion
  - Do NOT restrict agent types
  - Do NOT access SDK client directly (use manager)

  **Parallelizable**: NO (depends on Task 2, 4)

  **MUST READ first**:
  - `src/tools/omo-task/tools.ts:6-111` - tool factory pattern
  - `local-ignore/background-agent-analysis.md:427-458` - background_task spec

  **References**:
  - `src/tools/omo-task/tools.ts:12-21` - tool() function usage with schema

  **Acceptance Criteria**:
  - [x] Returns immediately after launch (non-blocking)
  - [x] Output includes task ID, session ID, description, agent, status
  - [x] Output instructs user to use `background_status` for progress
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 8)

---

- [x] **6. Implement background_status tool**

  **What to do**:
  - Add `background_status` to `src/tools/background-task/tools.ts`
  - Implement `createBackgroundStatus(manager: BackgroundManager)` factory
  - Tool should:
    - Accept optional taskId arg
    - If taskId: return single task status
    - If no taskId: return all tasks for current parent session
    - Format output with: description, status, duration, tool calls, last tool

  **Must NOT do**:
  - Do NOT return tasks from other parent sessions when taskId is omitted

  **Parallelizable**: NO (depends on Task 5)

  **MUST READ first**:
  - `local-ignore/background-agent-analysis.md:462-508` - background_status spec

  **Acceptance Criteria**:
  - [ ] Shows task status with duration (formatted human-readable)
  - [ ] Shows tool calls count and last tool name
  - [ ] Returns "No background tasks found" if empty
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 8)

---

- [x] **7. Implement background_result tool**

  **What to do**:
  - Add `background_result` to `src/tools/background-task/tools.ts`
  - Implement `createBackgroundResult(manager: BackgroundManager, client: OpencodeClient)` factory
  - Tool should:
    - Accept taskId arg (required)
    - Validate task exists and is completed
    - Fetch messages from child session via SDK
    - Extract last assistant message content
    - Return formatted result with duration

  **Must NOT do**:
  - Do NOT return result if task status != "completed"
  - Do NOT store full result in BackgroundTask (fetch on demand)

  **Parallelizable**: YES (with Task 6)

  **MUST READ first**:
  - `src/tools/omo-task/tools.ts:76-101` - message fetching pattern
  - `local-ignore/background-agent-analysis.md:498-529` - background_result spec

  **Acceptance Criteria**:
  - [ ] Returns error if task not found
  - [ ] Returns "Wait for completion" if task not completed
  - [ ] Fetches and returns assistant output from child session
  - [ ] Includes duration and session ID in output
  - [ ] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 8)

---

- [x] **8. Implement background_cancel tool** ✅ 완료

  **What to do**:
  - Add `background_cancel` to `src/tools/background-task/tools.ts`
  - Implement `createBackgroundCancel(manager: BackgroundManager, client: OpencodeClient)` factory
  - Tool should:
    - Accept taskId arg (required)
    - Validate task exists and is running
    - Call `client.session.abort()` on child session
    - Update task status to "cancelled"
    - Persist state
  - Create `src/tools/background-task/index.ts` barrel export

  **Must NOT do**:
  - Do NOT cancel if task status != "running"

  **Parallelizable**: YES (with Task 6, 7)

  **MUST READ first**:
  - `local-ignore/background-agent-analysis.md:531-559` - background_cancel spec

  **Acceptance Criteria**:
  - [x] Returns error if task not found
  - [x] Returns error if task not running
  - [x] Calls session.abort() on child session
  - [x] Updates task status and completedAt
  - [x] Persists state change
  - [x] `index.ts` exports all 4 tool factories
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(background-task): add 4 background task tools`
  - **Files to stage**: `src/tools/background-task/`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
  - **Rollback trigger**: Tool execution failures

---

### Phase 3: Notification System

- [x] **9. Create background notification hook** ✅ 완료

  **What to do**:
  - Create `src/hooks/background-notification/types.ts` with hook types
  - Create `src/hooks/background-notification/index.ts`
  - Implement `createBackgroundNotificationHook(manager: BackgroundManager)` factory
  - Return object with:
    - `event`: Forward events to manager.handleEvent()
    - `chat.message`: Inject completion notifications

  **Must NOT do**:
  - Do NOT process events not relevant to background tasks
  - Do NOT inject notifications for tasks from other sessions

  **Parallelizable**: NO (depends on Task 2)

  **MUST READ first**:
  - `src/hooks/session-notification.ts:153-199` - event handling pattern
  - `src/index.ts:100-103` - chat.message hook pattern
  - `local-ignore/background-agent-analysis.md:567-604` - hook spec

  **References**:
  - `local-ignore/background-agent-analysis.md:586-598` - notification format

  **Acceptance Criteria**:
  - [x] `event` handler forwards to manager.handleEvent()
  - [x] `chat.message` checks pending notifications for input.sessionID
  - [x] Injects formatted notification message into output.parts
  - [x] Clears notifications after injection
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 10)

---

- [x] **10. Integrate notification formatting** ✅ 완료

  **What to do**:
  - Add notification message formatting function
  - Format includes:
    - Task description and ID
    - Duration (human-readable)
    - Tool calls count
    - Instructions to use `background_result`
  - Use markdown format for clear presentation

  **Must NOT do**:
  - Do NOT use XML tags (use markdown)
  - Do NOT include full result in notification (just summary)

  **Parallelizable**: NO (depends on Task 9)

  **MUST READ first**:
  - `local-ignore/background-agent-analysis.md:586-598` - notification format spec

  **Acceptance Criteria**:
  - [x] Notification includes all required info
  - [x] Readable markdown format
  - [x] Includes instruction to retrieve full result
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(background-notification): add completion notification hook`
  - **Files to stage**: `src/hooks/background-notification/`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
  - **Rollback trigger**: Hook integration failures

---

### Phase 4: Integration

- [x] **11. Update tools/index.ts** ✅ 완료

  **What to do**:
  - Import background tool factories from `./background-task`
  - Export `createBackgroundTools` composite factory
  - Do NOT add to `builtinTools` (tools need manager instance)

  **Must NOT do**:
  - Do NOT add individual tools to builtinTools (they need runtime init)

  **Parallelizable**: YES (with Task 12, 13)

  **MUST READ first**:
  - `src/tools/index.ts` - current export pattern

  **Acceptance Criteria**:
  - [x] `createBackgroundTools` exported
  - [x] Takes manager and client as params, returns tool object
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 13)

---

- [x] **12. Update hooks/index.ts** ✅ 완료

  **What to do**:
  - Add export for `createBackgroundNotificationHook`

  **Must NOT do**:
  - Do NOT modify existing exports

  **Parallelizable**: YES (with Task 11, 13)

  **MUST READ first**:
  - `src/hooks/index.ts` - current export pattern

  **Acceptance Criteria**:
  - [x] Export added
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 13)

---

- [x] **13. Update main index.ts** ✅ 완료

  **What to do**:
  - Import BackgroundManager from features
  - Import createBackgroundTools from tools
  - Import createBackgroundNotificationHook from hooks
  - Initialize manager with ctx.client and store path
  - Call manager.restore() on init
  - Add background tools to tool object
  - Integrate notification hook into:
    - `event`: Call hook event handler
    - `chat.message`: Call hook chat.message handler
  - Disable background_task for explore/librarian agents (like omo_task)

  **Must NOT do**:
  - Do NOT break existing hook integrations
  - Do NOT remove any existing functionality

  **Parallelizable**: NO (depends on Task 11, 12)

  **MUST READ first**:
  - `src/index.ts` - full file for integration patterns

  **References**:
  - `src/index.ts:92` - omoTask creation pattern
  - `src/index.ts:100-103` - chat.message integration
  - `src/index.ts:162-264` - event integration
  - `src/index.ts:122-134` - agent tool restriction pattern

  **Acceptance Criteria**:
  - [ ] BackgroundManager initialized on plugin load
  - [ ] State restored from disk
  - [ ] All 4 background tools registered
  - [ ] Notification hook integrated into event and chat.message
  - [ ] explore/librarian agents have background_task disabled
  - [ ] `bun run typecheck` passes
  - [ ] `bun run build` succeeds

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(background-agent): integrate into main plugin`
  - **Files to stage**: `src/tools/index.ts`, `src/hooks/index.ts`, `src/index.ts`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
    - [ ] `bun run build` → Success
  - **Rollback trigger**: Plugin fails to load

---

- [x] **14. Final verification and cleanup**

  **What to do**:
  - Run full typecheck
  - Run full build
  - Verify all files are properly formatted
  - Check for any debug/console.log statements
  - Ensure no TODO comments left
  - Test tool descriptions are clear

  **Must NOT do**:
  - Do NOT add test files
  - Do NOT modify README (separate task)

  **Parallelizable**: NO (final task)

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` → No errors
  - [ ] `bun run build` → Success
  - [ ] No console.log in production code
  - [ ] No TODO comments
  - [ ] All exports working

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `chore(background-agent): final cleanup and verification`
  - **Files to stage**: Any cleanup changes
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
    - [ ] `bun run build` → Success
  - **Rollback trigger**: N/A (cleanup only)

---

## Commit Checkpoints Summary

| After Task | Commit Message | Pre-commit Commands | Rollback Condition |
|------------|----------------|---------------------|-------------------|
| Task 3 | `feat(background-agent): add BackgroundManager with persistence layer` | `bun run typecheck` | Type errors |
| Task 8 | `feat(background-task): add 4 background task tools` | `bun run typecheck` | Tool failures |
| Task 10 | `feat(background-notification): add completion notification hook` | `bun run typecheck` | Hook failures |
| Task 13 | `feat(background-agent): integrate into main plugin` | `bun run typecheck`, `bun run build` | Plugin load failure |
| Task 14 | `chore(background-agent): final cleanup and verification` | `bun run typecheck`, `bun run build` | N/A |

---

## Estimated Effort

- **Phase 1 (Core)**: 1-2 hours
- **Phase 2 (Tools)**: 2-3 hours
- **Phase 3 (Notification)**: 1 hour
- **Phase 4 (Integration)**: 1 hour
- **Total**: ~6 hours

---

## Notes

- `promptAsync()` API is key - documented in analysis as existing in OpenCode SDK
- Session parent-child relationship handles automatic cleanup (cascade delete)
- Event filtering is critical for performance - only process relevant events
- Debounced persistence prevents excessive disk I/O
