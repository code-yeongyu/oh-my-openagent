# Fix #5120: Sisyphus infinite planning loop - todo-continuation-enforcer progress oracle

## Root cause

`packages/omo-opencode/src/hooks/todo-continuation-enforcer/session-state.ts:158`

```ts
const hasProgressed = incompleteCount < previousIncompleteCount || hasCompletedMoreTodos || hasTodoSnapshotChanged
```

`hasTodoSnapshotChanged` is true on ANY `{id -> status}` diff. A model stuck in a
planning loop toggles todo statuses each turn ("Progress (Done/In Progress/Blocked)"
re-emission from issue #5120). Every post-injection turn therefore reads as
"progress": `stagnationCount` resets to 0 and `continuationBlockReason` never
survives, defeating BOTH built-in terminators (`MAX_STAGNATION_COUNT = 3` via
`shouldStopForStagnation`, and the `directive-response` block). The enforcer then
re-injects CONTINUATION_PROMPT on every idle forever = infinite planning loop.

Stagnation only accumulates on turns following an actual injection
(`hadSuccessfulInjectionAwaitingProgressCheck` gate), so the fix is scoped to
exactly the inject -> reply cycle that drives the loop.

## Change (minimal, one seam)

### 1. session-state.ts
- Progress predicate becomes monotonic-only:
  `incompleteCount < previousIncompleteCount || hasCompletedMoreTodos`.
  Status churn / todo add-remove without completion-count movement is NOT progress.
- Remove now-dead snapshot machinery: `getTodoSnapshot()`, `currentTodoSnapshot`,
  `hasTodoSnapshotChanged`, `lastTodoSnapshot` field + writes + reset line.
- Comment at the predicate citing #5120 (extends the #4013 P0.2 rationale:
  non-monotonic todo diffs are not progress).

### 2. session-state.test.ts (failing-first)
- INVERT "given todo status changes without count changes, treats it as progress"
  -> status churn must NOT be progress; stagnation increments (#5120).
- ADD loop-termination test: three consecutive churned post-injection turns drive
  `stagnationCount` to MAX_STAGNATION_COUNT and `shouldStopForStagnation` returns true.
- REWRITE "given progress resumes after stagnation" fixture to use REAL progress
  (todo completed + new todo added: completed-count increases) preserving its intent.

No other test files pin churn-as-progress (verified by grep over regression,
stagnation-detection, idle-event tests).

## Verification

1. Failing-first: run `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/session-state.test.ts`
   BEFORE the fix -> new/updated tests must FAIL against current code.
2. Apply fix -> same command green.
3. Full scoped gate: `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/`.
4. Typecheck: `bun run typecheck` (tsgo authoritative).
5. Evidence under `.omo/evidence/20260825-sisyphus-planning-loop/`.

## Residual risk

A legitimate reply-to-injection that only reorganizes todos (no completions) now
counts toward stagnation and stops re-arming after 3 such turns. Real work still
clears the block: any completed-count increase or incomplete-count decrease resets
stagnation and clears `continuationBlockReason`. User interruption provenance and
all other guards untouched.
