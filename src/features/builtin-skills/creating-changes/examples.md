# Examples: Creating Changes in Action

## Example 1: Research Task

**User Request:** "Research the best practices for WebSocket reconnection and implement them"

### Step 1: Brainstorming (Conversation Only)

```
User: I need to implement WebSocket reconnection logic
Agent: Let me explore your requirements...
- What's your current WebSocket implementation?
- Do you need exponential backoff?
- Should it persist across page refreshes?
```

### Step 2: Creating Changes (5-File Workflow)

After brainstorming, agent creates `changes/websocket-reconnect/`:

**proposal.md:**
```markdown
# Proposal: WebSocket Reconnection

## Problem
Current WebSocket drops connection without recovery.

## Solution
Implement reconnection with exponential backoff.

## Scope
- Add reconnection logic to WebSocketClient
- Add connection state management
- Add retry configuration
```

**design.md:**
```markdown
# Design: WebSocket Reconnection

## Architecture
- ReconnectionManager class handles retry logic
- Exponential backoff: 1s, 2s, 4s, 8s, max 30s
- State machine: connected → disconnected → reconnecting → connected

## Files to Modify
- src/network/WebSocketClient.ts
- src/network/ReconnectionManager.ts (new)
- src/hooks/useWebSocket.ts
```

**tasks.md:**
```markdown
# Tasks: WebSocket Reconnection

## Phase 1: Core Implementation `pending`
- [ ] Task 1.1: Create ReconnectionManager class
- [ ] Task 1.2: Add backoff calculation

## Phase 2: Integration `pending`
- [ ] Task 2.1: Integrate with WebSocketClient
- [ ] Task 2.2: Add state events

## Phase 3: Testing `pending`
- [ ] Task 3.1: Unit tests
- [ ] Task 3.2: Integration tests
```

**findings.md:**
```markdown
# Findings: WebSocket Reconnection

## Research
- Found exponential backoff pattern in RFC 6455
- Existing codebase uses EventEmitter pattern

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Max retry: 30s | Balance between responsiveness and server load |
| Jitter: ±10% | Prevent thundering herd |
```

**progress.md:**
```markdown
# Progress: WebSocket Reconnection

## 2026-01-22

### Phase 1 Started
- Task 1.1: In progress
- Created ReconnectionManager skeleton
```

---

## Example 2: Bug Fix Task

**User Request:** "Fix the login bug - users getting logged out unexpectedly"

### findings.md During Investigation
```markdown
# Findings: Login Bug

## Bug Report
- Users report random logouts
- Happens after ~1 hour of activity

## Investigation
1. Checked auth token expiry → Set to 1 hour ✓
2. Checked refresh logic → **Found issue!**
   - Refresh triggers at 1 minute before expiry
   - But API call takes 30s under load
   - Race condition causes logout

## Root Cause
TOKEN_REFRESH_BUFFER is too small (60000ms = 1 minute)
Should be 5 minutes (300000ms) to handle slow networks

## Files Affected
- src/auth/token.ts:42 - TOKEN_REFRESH_BUFFER constant
```

### progress.md During Fix
```markdown
# Progress: Login Bug Fix

## 2026-01-22

### Investigation Complete
- Root cause: TOKEN_REFRESH_BUFFER too small
- Solution: Increase from 1 min to 5 min

### Fix Applied
- [x] Updated TOKEN_REFRESH_BUFFER to 300000
- [x] Added buffer config option
- [x] Updated tests

### Test Results
| Suite | Status |
|-------|--------|
| auth.test.ts | ✅ Pass (12/12) |
| token.test.ts | ✅ Pass (8/8) |
```

---

## Example 3: Feature Development

**User Request:** "Add a dark mode toggle to the settings page"

### The 5-File Pattern in Action

**proposal.md:**
```markdown
# Proposal: Dark Mode Toggle

## Problem
Users want dark mode for reduced eye strain.

## Solution
Add toggle in settings with system preference detection.

## Success Criteria
- Toggle persists across sessions
- Respects system preference on first load
- Smooth transition animation
```

**findings.md:**
```markdown
# Findings: Dark Mode

## Existing Theme System
- Location: src/styles/theme.ts
- Pattern: CSS custom properties
- Current: Light only

## Files to Modify
1. src/styles/theme.ts - Add dark theme colors
2. src/components/SettingsPage.tsx - Add toggle
3. src/hooks/useTheme.ts - Create new hook
4. src/App.tsx - Wrap with ThemeProvider

## Color Decisions
| Element | Light | Dark |
|---------|-------|------|
| Background | #ffffff | #1a1a2e |
| Surface | #f5f5f5 | #16213e |
| Text | #333333 | #eaeaea |

## Browser Operations
1. Checked system preference API → `prefers-color-scheme`
2. Checked localStorage pattern → Standard approach

*(Saved after 2 browser ops - 2-Action Rule)*
```

**progress.md:**
```markdown
# Progress: Dark Mode

## 2026-01-22

### Phase 1: Research `complete`
- Analyzed existing theme system
- Documented in findings.md

### Phase 2: Implementation `in_progress`
- [x] Task 2.1: Add dark theme colors
- [x] Task 2.2: Create useTheme hook
- [ ] Task 2.3: Add toggle component ← Current

### Actions Taken
- Created src/hooks/useTheme.ts
- Extended theme.ts with dark palette
- Committed: abc123

### Test Results
| Suite | Status |
|-------|--------|
| theme.test.ts | ✅ Pass |
| useTheme.test.ts | ✅ Pass |
```

---

## Example 4: Error Recovery Pattern (3-Strike Protocol)

When something fails repeatedly, don't keep trying:

### Wrong Approach
```
Attempt 1: Fix by changing X → Failed
Attempt 2: Fix by changing Y → Failed
Attempt 3: Fix by changing Z → Failed
Attempt 4: Fix by changing W → Failed  ← WRONG!
```

### Correct Approach (3-Strike Protocol)
```
Attempt 1: Fix by changing X → Failed
  → Log to progress.md

Attempt 2: Fix by changing Y → Failed
  → Log to progress.md

Attempt 3: Fix by changing Z → Failed
  → Log to progress.md
  → STOP! 3-Strike threshold reached
  → Escalate for architectural review
```

### progress.md After 3 Failures
```markdown
## Debug Log: Database Connection Issue

### Attempt 1 - 10:30 AM
- **Hypothesis:** Connection pool exhausted
- **Action:** Increased pool size from 10 to 50
- **Result:** ❌ Failed - Same error

### Attempt 2 - 10:45 AM
- **Hypothesis:** Timeout too short
- **Action:** Increased timeout from 5s to 30s
- **Result:** ❌ Failed - Same error

### Attempt 3 - 11:00 AM
- **Hypothesis:** DNS resolution issue
- **Action:** Switched to IP address
- **Result:** ❌ Failed - Same error

### Escalation
**3-Strike threshold reached. Architectural review needed.**

Pattern observed: All connection attempts fail identically,
regardless of pool/timeout/DNS changes.

Suggested discussion:
- Is the database server reachable at all?
- Are we behind a firewall blocking the port?
- Is there an authentication issue at network level?
```

---

## The Read-Before-Decide Pattern

**Always read your plan before major decisions:**

```
[Many tool calls have happened...]
[Context is getting long...]
[Original goal might be forgotten...]

→ Read tasks.md              # Goals refresh into attention!
→ Read findings.md           # Decisions refresh!
→ Now make the decision      # Full context available
```

This is why Manus-style planning handles ~50 tool calls without losing track. The planning files act as a "goal refresh" mechanism.

---

## 2-Action Rule in Practice

After every 2 browser/view operations, save to findings.md:

```
1. Read API docs → note in memory
2. Read implementation example → SAVE to findings.md ← 2nd action
3. Read test patterns → note in memory
4. Read error handling → SAVE to findings.md ← 4th action
```

This prevents information loss in long context windows.
