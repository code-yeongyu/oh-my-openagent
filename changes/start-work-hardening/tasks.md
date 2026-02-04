# Tasks: start-work-hardening

## TL;DR
- Enforce explicit execution mode selection in /start-work (no auto-run).
- Create a plan-level git worktree named `worktree-{plan-name}` after mode selection.
- Persist mode + worktree metadata in boulder state and inject correct skill guidance.

## Execution Strategy (Wave Grouping)
- Wave 1: State + worktree primitives
- Wave 2: Start-work hook integration + prompt changes
- Wave 3: Validation and edge-case checks

## Dependency Matrix
| Task | Depends On |
| --- | --- |
| 1.1 | None |
| 1.2 | 1.1 |
| 2.1 | 1.2 |
| 2.2 | 2.1 |
| 3.1 | 2.2 |

---

## Wave 1: State + Worktree Primitives

### Task 1.1: Add plan worktree metadata to boulder state
**Description:** Extend boulder state types/storage to record plan-level worktree metadata and selected execution mode.

**Recommended Agent Profile:**
- category: business-logic
- skills: ["backend-pattern-typescript"]

**Parallelization:** None (schema changes first).

**Files:**
- Modify: `src/features/boulder-state/types.ts`
- Modify: `src/features/boulder-state/storage.ts`

**Acceptance Criteria:**
- [ ] boulder state includes `plan_worktree` fields (path, branch, status, timestamps)
- [ ] boulder state includes selected execution mode
- [ ] Read/write functions remain backward compatible

---

### Task 1.2: Implement plan-level worktree helpers
**Description:** Add helpers to create and reuse a plan-level worktree named `worktree-{plan-name}` in `.worktrees/`.

**Recommended Agent Profile:**
- category: business-logic
- skills: ["backend-pattern-typescript"]

**Parallelization:** Can run in parallel with Task 1.1 only after type updates are ready.

**Files:**
- Modify: `src/features/boulder-state/worktree-manager.ts`

**Acceptance Criteria:**
- [ ] `ensurePlanWorktree` is idempotent
- [ ] Worktree path uses `.worktrees/worktree-{plan-name}` with sanitized name
- [ ] Existing worktrees are detected via state or `git worktree list`
- [ ] Errors are surfaced with actionable messages

---

## Wave 2: Start-Work Hook Integration

### Task 2.1: Enforce execution mode selection
**Description:** Replace auto-activation with a forced `question` prompt requiring explicit Sequential or Wave choice; persist the selection in boulder state to avoid re-prompt on resume.

**Recommended Agent Profile:**
- category: business-logic
- skills: ["backend-pattern-typescript"]

**Parallelization:** Blocked by Task 1.1 (needs state field).

**Files:**
- Modify: `src/hooks/start-work/index.ts`

**Acceptance Criteria:**
- [ ] User must select a mode before any execution instructions are given
- [ ] Selection is stored and reused on resume
- [ ] Prompt no longer auto-activates Wave mode

---

### Task 2.2: Create plan worktree on start-work
**Description:** Call `ensurePlanWorktree` after plan resolution and before execution guidance; inject worktree details into the context.

**Recommended Agent Profile:**
- category: business-logic
- skills: ["backend-pattern-typescript"]

**Parallelization:** After Task 2.1.

**Files:**
- Modify: `src/hooks/start-work/index.ts`

**Acceptance Criteria:**
- [ ] Worktree is created or reused for the active plan
- [ ] Context includes worktree path + branch
- [ ] On failure, execution guidance is blocked with a clear error

---

## Wave 3: Validation

### Task 3.1: Verify resume + edge cases
**Description:** Validate behavior for existing boulder state, completed plans, and worktree conflicts.

**Recommended Agent Profile:**
- category: quick
- skills: ["git-master"]

**Parallelization:** After Task 2.2.

**Files:**
- None (verification only)

**Acceptance Criteria:**
- [ ] Resume does not re-prompt mode if already stored
- [ ] Completed plans do not create new worktrees
- [ ] Conflicting worktree path is detected and reported

---

## Legend
- [ ] Pending
- [x] Complete
- [~] In Progress
