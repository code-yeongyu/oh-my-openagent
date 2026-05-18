# PR #3990 Merge Conflict Resolution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 13 merge conflicts between `upstream-pr/decouple-barrel` and `upstream/dev` so PR #3990 becomes mergeable.

**Architecture:** All 13 conflicts are import-style collisions. HEAD (our branch) decouples barrel imports into direct file imports (`../../shared/logger`), while upstream/dev consolidated back to barrel imports (`../../shared`) and added new symbols. Resolution strategy: keep HEAD's decoupled imports (preserves the PR's purpose) and add any NEW symbols upstream introduced, using their correct direct file paths.

**Tech Stack:** TypeScript, git merge conflict resolution

---

## Critical Symbol Map

All new symbols upstream introduced and their **correct** source files:

| Symbol | Source File |
|--------|-------------|
| `isRealUserTextPart` | `src/shared/internal-initiator-marker.ts` |
| `isSyntheticOrInternalOnlyTextParts` | `src/shared/internal-initiator-marker.ts` |
| `isRealUserMessage` | `src/shared/internal-initiator-marker.ts` |
| `isSyntheticOrInternalUserMessage` | `src/shared/internal-initiator-marker.ts` |
| `isRecord` | `src/shared/record-type-guard.ts` |
| `stripAgentListSortPrefix` | `src/shared/agent-display-names.ts` |
| `normalizeAgentForPrompt` | `src/shared/agent-display-names.ts` (upstream renamed from `normalizeAgentForPromptKey`) |
| `promptAsyncAfterSessionIdle` | `src/shared/prompt-async-gate.ts` |
| `WindowState` | `src/features/tmux-subagent/types.ts` |
| `getMainSessionID`, `getSessionAgent`, `subagentSessions`, `setSessionAgent` | `src/features/claude-code-session-state` |
| `ContextCollector` | `src/features/context-injector` |
| `RalphLoopHook` | `src/hooks/ralph-loop` |

---

## Conflict Map

All conflicts are in the import section of each file. Pattern:

```
<<<<<<< HEAD
// Decoupled: import { log } from "../../shared/logger"
=======
// Barrel:    import { log, ... } from "../../shared"
//            + possibly new imports upstream added
>>>>>>> upstream/dev
```

**Resolution rule for every file:** Keep HEAD's decoupled imports. Add any new symbols from upstream that HEAD doesn't already import, using their correct direct file paths (not the barrel).

---

### Task 1: Resolve `src/plugin/chat-message.ts`

**Files:**
- Modify: `src/plugin/chat-message.ts` lines 4-16

**Current conflict:**
```typescript
<<<<<<< HEAD
import { isModelCacheAvailable } from "../shared/model-availability"
import { log } from "../shared/logger"
=======
import { getMainSessionID, setSessionAgent, subagentSessions } from "../features/claude-code-session-state"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import {
  isModelCacheAvailable,
  isRealUserTextPart,
  isSyntheticOrInternalOnlyTextParts,
  log,
} from "../shared"
>>>>>>> upstream/dev
```

**Resolution:** Merge both sides — keep decoupled imports from HEAD, add the 2 new imports upstream added from other modules, and add `isRealUserTextPart` + `isSyntheticOrInternalOnlyTextParts` from `internal-initiator-marker`:

- [ ] **Step 1: Replace the conflict block**

Replace lines 4-16 (the entire `<<<<<<<` to `>>>>>>>` block) with:

```typescript
import { getMainSessionID, setSessionAgent, subagentSessions } from "../features/claude-code-session-state"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import { isModelCacheAvailable } from "../shared/model-availability"
import { isRealUserTextPart, isSyntheticOrInternalOnlyTextParts } from "../shared/internal-initiator-marker"
import { log } from "../shared/logger"
```

- [ ] **Step 2: Verify no barrel import remains**

Run:
```bash
grep 'from "../shared"' src/plugin/chat-message.ts
```
Should return nothing (all imports should be decoupled).

- [ ] **Step 3: Commit**

```bash
git add src/plugin/chat-message.ts
git commit -m "fix: resolve chat-message.ts merge conflict - keep decoupled imports"
```

---

### Task 2: Resolve `src/features/background-agent/manager.ts`

**Files:**
- Modify: `src/features/background-agent/manager.ts` lines 12-30

**Current conflict:**
```typescript
<<<<<<< HEAD
import { log } from "../../shared/logger"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { normalizePromptTools, resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { messagesInDirectory, promptAsyncInDirectory, promptWithRetryInDirectory } from "../../shared/session-route"
=======
import {
  log,
  getAgentToolRestrictions,
  normalizePromptTools,
  normalizeSDKResponse,
  resolveInheritedPromptTools,
  createInternalAgentTextPart,
  messagesInDirectory,
  promptWithRetryInDirectory,
} from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep HEAD's decoupled imports. Note that upstream dropped `promptAsyncInDirectory` — HEAD still has it, so keep it.

- [ ] **Step 1: Replace the conflict block**

Replace lines 12-30 with HEAD's decoupled imports:

```typescript
import { log } from "../../shared/logger"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { normalizePromptTools, resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { messagesInDirectory, promptAsyncInDirectory, promptWithRetryInDirectory } from "../../shared/session-route"
```

- [ ] **Step 2: Verify `promptAsyncInDirectory` is used**

```bash
grep "promptAsyncInDirectory" src/features/background-agent/manager.ts
```
If not used anywhere else in the file, remove it from the import. If used, keep it.

- [ ] **Step 3: Verify no barrel import remains**

```bash
grep 'from "../../shared"' src/features/background-agent/manager.ts | grep -v 'shared/logger\|shared/agent-tool\|shared/prompt\|shared/normalize\|shared/internal\|shared/session-route\|shared/event-session\|shared/session-prompt\|shared/session-tools\|shared/session-category\|shared/tmux\|shared/model-error'
```
Should return nothing.

- [ ] **Step 4: Commit**

```bash
git add src/features/background-agent/manager.ts
git commit -m "fix: resolve manager.ts merge conflict - keep decoupled imports"
```

---

### Task 3: Resolve `src/features/context-injector/injector.ts`

**Files:**
- Modify: `src/features/context-injector/injector.ts` lines 2-6

**Current conflict:**
```typescript
<<<<<<< HEAD
import { log } from "../../shared/logger"
=======
import { isRealUserMessage, isRealUserTextPart, log } from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled `log`, add `isRealUserMessage` and `isRealUserTextPart` from `internal-initiator-marker.ts`.

- [ ] **Step 1: Replace the conflict block**

Replace lines 2-6 with:

```typescript
import { log } from "../../shared/logger"
import { isRealUserMessage, isRealUserTextPart } from "../../shared/internal-initiator-marker"
```

- [ ] **Step 2: Verify both symbols are used**

```bash
grep "isRealUserMessage" src/features/context-injector/injector.ts
grep "isRealUserTextPart" src/features/context-injector/injector.ts
```
Both should find usages in the file.

- [ ] **Step 3: Commit**

```bash
git add src/features/context-injector/injector.ts
git commit -m "fix: resolve injector.ts merge conflict - keep decoupled imports"
```

---

### Task 4: Resolve `src/features/tmux-subagent/polling-manager.ts`

**Files:**
- Modify: `src/features/tmux-subagent/polling-manager.ts` lines 8-16

**Current conflict:**
```typescript
<<<<<<< HEAD
import type { TrackedSession } from "./types"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
=======
import type { TrackedSession, WindowState } from "./types"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled imports. Add `WindowState` type from `./types` (upstream added it).

- [ ] **Step 1: Replace the conflict block**

Replace lines 8-16 with:

```typescript
import type { TrackedSession, WindowState } from "./types"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
```

- [ ] **Step 2: Verify `WindowState` is exported from `./types`**

```bash
grep "WindowState" src/features/tmux-subagent/types.ts
```
Should find `export interface WindowState`.

- [ ] **Step 3: Commit**

```bash
git add src/features/tmux-subagent/polling-manager.ts
git commit -m "fix: resolve polling-manager.ts merge conflict - keep decoupled imports"
```

---

### Task 5: Resolve `src/hooks/atlas/boulder-continuation-injector.ts`

**Files:**
- Modify: `src/hooks/atlas/boulder-continuation-injector.ts` lines 8-15

**Current conflict:**
```typescript
<<<<<<< HEAD
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { isSessionActive } from "../shared/session-idle-settle"
=======
import { createInternalAgentContinuationTextPart, resolveInheritedPromptTools } from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled imports. Add `promptAsyncAfterSessionIdle` from upstream.

- [ ] **Step 1: Replace the conflict block**

Replace lines 8-15 with:

```typescript
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { isSessionActive } from "../shared/session-idle-settle"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
```

- [ ] **Step 2: Verify `promptAsyncAfterSessionIdle` is used**

```bash
grep "promptAsyncAfterSessionIdle" src/hooks/atlas/boulder-continuation-injector.ts
```
Should find usage at line ~101.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/atlas/boulder-continuation-injector.ts
git commit -m "fix: resolve boulder-continuation-injector.ts merge conflict - keep decoupled imports"
```

---

### Task 6: Resolve `src/hooks/keyword-detector/hook.ts`

**Files:**
- Modify: `src/hooks/keyword-detector/hook.ts` lines 3-32

**Current conflict:**
```typescript
<<<<<<< HEAD
import type { DetectedKeyword } from "./detector"
import { detectKeywordsWithType, extractPromptText, looksLikeSlashCommand } from "./detector"
import { isPlannerAgent, isNonOmoAgent } from "./constants"
import { log } from "../../shared/logger"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
>>>>>>> upstream/dev
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import {
  isRealUserTextPart,
  isSyntheticOrInternalOnlyTextParts,
  log,
} from "../../shared"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
import type { RalphLoopHook } from "../ralph-loop"
import { isNonOmoAgent, isPlannerAgent } from "./constants"
import type { DetectedKeyword } from "./detector"
import { detectKeywordsWithType, extractPromptText, looksLikeSlashCommand } from "./detector"
```

**Resolution:** Keep HEAD's decoupled imports. Add the new imports upstream added (`claude-code-session-state`, `ContextCollector`, `isRealUserTextPart`, `isSyntheticOrInternalOnlyTextParts`, `RalphLoopHook`). Remove duplicate `log` from barrel.

- [ ] **Step 1: Replace the entire import section (lines 3-32)**

Replace lines 3-32 with:

```typescript
import type { DetectedKeyword } from "./detector"
import { detectKeywordsWithType, extractPromptText, looksLikeSlashCommand } from "./detector"
import { isPlannerAgent, isNonOmoAgent } from "./constants"
import { log } from "../../shared/logger"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import { isRealUserTextPart, isSyntheticOrInternalOnlyTextParts } from "../../shared/internal-initiator-marker"
import type { RalphLoopHook } from "../ralph-loop"
```

- [ ] **Step 2: Verify no barrel import remains**

```bash
grep 'from "../../shared"' src/hooks/keyword-detector/hook.ts | grep -v 'shared/logger\|shared/system-directive\|shared/internal-initiator'
```
Should return nothing.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/keyword-detector/hook.ts
git commit -m "fix: resolve keyword-detector/hook.ts merge conflict - keep decoupled imports"
```

---

### Task 7: Resolve `src/hooks/ralph-loop/continuation-prompt-injector.ts`

**Files:**
- Modify: `src/hooks/ralph-loop/continuation-prompt-injector.ts` lines 6-21

**Current conflict:**
```typescript
<<<<<<< HEAD
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import { isRecord } from "../../shared/record-type-guard"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { normalizeAgentForPromptKey } from "../../shared/agent-display-names"
=======
import {
  createInternalAgentContinuationTextPart,
  isRecord,
  normalizeSDKResponse,
  resolveInheritedPromptTools,
} from "../../shared"
import { normalizeAgentForPrompt, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled imports. Add `promptAsyncAfterSessionIdle` and `stripAgentListSortPrefix`. Upstream renamed `normalizeAgentForPromptKey` to `normalizeAgentForPrompt` — adopt the new name and rename all usages.

- [ ] **Step 1: Replace the conflict block**

Replace lines 6-21 with:

```typescript
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import { isRecord } from "../../shared/record-type-guard"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
import { normalizeAgentForPrompt, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
```

- [ ] **Step 2: Rename `normalizeAgentForPromptKey` to `normalizeAgentForPrompt`**

The file uses `normalizeAgentForPromptKey` at line 11 (import) and potentially in the body. After Step 1, the import is already corrected to `normalizeAgentForPrompt`. Check if any usages in the body still reference the old name:

```bash
grep "normalizeAgentForPromptKey" src/hooks/ralph-loop/continuation-prompt-injector.ts
```
If found, rename to `normalizeAgentForPrompt`. (Line 85 already uses `normalizeAgentForPrompt`, so this should be clean.)

- [ ] **Step 3: Verify `promptAsyncAfterSessionIdle` is used**

```bash
grep "promptAsyncAfterSessionIdle" src/hooks/ralph-loop/continuation-prompt-injector.ts
```
Should find usage at line ~150.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/ralph-loop/continuation-prompt-injector.ts
git commit -m "fix: resolve continuation-prompt-injector.ts merge conflict - keep decoupled imports"
```

---

### Task 8: Resolve `src/hooks/session-recovery/recover-tool-result-missing.ts`

**Files:**
- Modify: `src/hooks/session-recovery/recover-tool-result-missing.ts` lines 5-10

**Current conflict:**
```typescript
<<<<<<< HEAD
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
=======
import { normalizeSDKResponse } from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled import. Add `promptAsyncAfterSessionIdle`.

- [ ] **Step 1: Replace the conflict block**

Replace lines 5-10 with:

```typescript
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
```

- [ ] **Step 2: Verify `promptAsyncAfterSessionIdle` is used**

```bash
grep "promptAsyncAfterSessionIdle" src/hooks/session-recovery/recover-tool-result-missing.ts
```
Should find usage at line ~138.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/session-recovery/recover-tool-result-missing.ts
git commit -m "fix: resolve recover-tool-result-missing.ts merge conflict - keep decoupled imports"
```

---

### Task 9: Resolve `src/hooks/session-recovery/resume.ts`

**Files:**
- Modify: `src/hooks/session-recovery/resume.ts` lines 1-13

**Current conflict:**
```typescript
import {
  createInternalAgentContinuationTextPart,
  isRealUserMessage,
  resolveInheritedPromptTools,
} from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
import type { MessageData, ResumeConfig } from "./types"
<<<<<<< HEAD
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import { resolveInheritedPromptTools } from "../../shared/prompt-tools"
=======
>>>>>>> upstream/dev
```

**Resolution:** The barrel imports at lines 2-6 already cover everything needed. Remove the duplicate HEAD imports (lines 10-12). Keep the upstream structure. This is the one file where keeping the barrel import is correct since there are no other decoupled imports in this file to preserve.

- [ ] **Step 1: Replace lines 1-13**

Replace lines 1-13 with:

```typescript
import type { createOpencodeClient } from "@opencode-ai/sdk"
import {
  createInternalAgentContinuationTextPart,
  isRealUserMessage,
  resolveInheritedPromptTools,
} from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"
import type { MessageData, ResumeConfig } from "./types"
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/session-recovery/resume.ts
git commit -m "fix: resolve resume.ts merge conflict - remove duplicate imports"
```

---

### Task 10: Resolve `src/hooks/todo-continuation-enforcer/idle-event.ts`

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer/idle-event.ts` lines 4-9

**Current conflict:**
```typescript
<<<<<<< HEAD
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { log } from "../../shared/logger"
=======
import { normalizeSDKResponse } from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled imports from HEAD. Upstream dropped `log` but it's still used in the file.

- [ ] **Step 1: Verify `log` is used**

```bash
grep "log\[" src/hooks/todo-continuation-enforcer/idle-event.ts | head -5
```
Should find usages.

- [ ] **Step 2: Replace the conflict block**

Replace lines 4-9 with HEAD's imports:

```typescript
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { log } from "../../shared/logger"
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/todo-continuation-enforcer/idle-event.ts
git commit -m "fix: resolve idle-event.ts merge conflict - keep decoupled imports"
```

---

### Task 11: Resolve `src/hooks/todo-continuation-enforcer/resolve-message-info.ts`

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer/resolve-message-info.ts` lines 3-7

**Current conflict:**
```typescript
<<<<<<< HEAD
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
=======
import { isSyntheticOrInternalUserMessage, normalizeSDKResponse } from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled import. Add `isSyntheticOrInternalUserMessage` from `internal-initiator-marker.ts`.

- [ ] **Step 1: Replace the conflict block**

Replace lines 3-7 with:

```typescript
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { isSyntheticOrInternalUserMessage } from "../../shared/internal-initiator-marker"
```

- [ ] **Step 2: Verify `isSyntheticOrInternalUserMessage` is used**

```bash
grep "isSyntheticOrInternalUserMessage" src/hooks/todo-continuation-enforcer/resolve-message-info.ts
```
Should find usage at line 38.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/todo-continuation-enforcer/resolve-message-info.ts
git commit -m "fix: resolve resolve-message-info.ts merge conflict - keep decoupled imports"
```

---

### Task 12: Resolve `src/cli/run/poll-for-completion.ts`

**Files:**
- Modify: `src/cli/run/poll-for-completion.ts` lines 5-9

**Current conflict:**
```typescript
<<<<<<< HEAD
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
=======
import { isRecord, normalizeSDKResponse } from "../../shared"
>>>>>>> upstream/dev
```

**Resolution:** Keep decoupled import. Add `isRecord` from `record-type-guard.ts`.

- [ ] **Step 1: Replace the conflict block**

Replace lines 5-9 with:

```typescript
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { isRecord } from "../../shared/record-type-guard"
```

- [ ] **Step 2: Verify `isRecord` is used**

```bash
grep "isRecord" src/cli/run/poll-for-completion.ts
```
Should find usage at line 22.

- [ ] **Step 3: Commit**

```bash
git add src/cli/run/poll-for-completion.ts
git commit -m "fix: resolve poll-for-completion.ts merge conflict - keep decoupled imports"
```

---

### Task 13: Verify build and tests pass

**Files:** None (verification task)

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 2: Run build**

```bash
bun run build
```
Expected: Exit code 0.

- [ ] **Step 3: Run tests**

```bash
bun test
```
Expected: All tests pass (note any pre-existing failures).

- [ ] **Step 4: Verify no remaining conflict markers**

```bash
grep -rn "<<<<<<" src/ || echo "No conflict markers found"
```
Expected: "No conflict markers found"

---

### Task 14: Push to remote and update PR

- [ ] **Step 1: Push the resolved branch**

```bash
git push origin upstream-pr/decouple-barrel
```

- [ ] **Step 2: Verify PR status**

```bash
gh pr view 3990 --repo code-yeongyu/oh-my-openagent --json mergeable,mergeStateStatus
```
Expected: `mergeable: "MERGEABLE"`, `mergeStateStatus: "CLEAN"`

---

## Self-Review

**1. Spec coverage:** All 13 conflict files addressed (Tasks 1-12), plus verification (Task 13) and push (Task 14). Each task has exact file paths, line numbers, and resolved code.

**2. Placeholder scan:** No TBD/TODO placeholders. Every step contains concrete code, commands, and expected output.

**3. Type consistency:** All import paths reference actual files verified via grep:
- `internal-initiator-marker.ts`: exports `isRealUserTextPart`, `isSyntheticOrInternalOnlyTextParts`, `isRealUserMessage`, `isSyntheticOrInternalUserMessage`
- `record-type-guard.ts`: exports `isRecord`
- `agent-display-names.ts`: exports `stripAgentListSortPrefix`, `normalizeAgentForPrompt`
- `prompt-async-gate.ts`: exports `promptAsyncAfterSessionIdle`
- `tmux-subagent/types.ts`: exports `WindowState`
- `claude-code-session-state`: exports `getMainSessionID`, `getSessionAgent`, `subagentSessions`, `setSessionAgent`

**4. Task 9 special case:** `resume.ts` correctly keeps the barrel import since the file has no other decoupled imports to preserve. The duplicate HEAD imports are redundant.

**5. Task 7 rename:** `normalizeAgentForPromptKey` was renamed to `normalizeAgentForPrompt` by upstream. The resolved import uses the new name, and line 85 already calls `normalizeAgentForPrompt`.
