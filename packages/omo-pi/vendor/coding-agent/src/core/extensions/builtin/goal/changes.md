# goal Extension Changes

## Overview
Persistent per-thread goal tracking as an in-tree builtin. Ports the standalone
`pi-goal` extension into senpi with no dependency on it, file-based persistence,
codex-aligned tool naming, and the budget concept removed.

## Initial port — budget-free, file-based goal builtin (2026-06-15)

### What changed
- New builtin extension `goal` (`builtin/goal/`), registered last in
  `builtin/index.ts` `builtinExtensions`. Exposes `create_goal`, `update_goal`,
  `get_goal` and the `/goal` command.
- Ported from `code-yeongyu/pi-goal` (`src/goal/*`) module-for-module:
  `store`, `types`, `validation`, `continuation`, `prompt`, `format`, `command`,
  `errors`, `index`. No runtime or dev dependency on `pi-goal`.
- File-based persistence retained: `GoalFile{version:1, goal}` under
  `<sessionDir>/extensions/goal/<threadId>.json`, with a
  `getAgentDir()/extensions/goal/no-session/<sha256(cwd)[:24]>` fallback.

### Budget removal (the deliberate divergence)
- Dropped the `token_budget` create param and the `Goal.tokenBudget` field.
- Dropped the `budgetLimited` status; `GoalStatus` is now `active|paused|complete`.
- Removed `validateTokenBudget`, the budget-limit continuation prompt, the
  `goal-budget-limit` message type, and every budget-driven status transition
  (`statusAfterBudgetLimit`/`statusAfterAccounting` budget branches).
- `GoalAccountingMode` collapsed to `active | activeOrComplete`; `accountGoalUsage`
  only increments `tokensUsed`/`timeUsedSeconds` and never changes status.
- Tool descriptions and the continuation prompt rewritten to drop budget language
  (the `get_goal` "budgets / remaining token budget" wording, the create
  "token budget" lines, the update "budget-limit" lines).

### Senpi adaptations vs upstream pi-goal
- Imports `getAgentDir()` from `src/config.ts` (env `SENPI_CODING_AGENT_DIR`,
  fallback `~/.senpi/agent`) instead of pi-goal's `.pi` agent dir.
- Tool error results are signaled by throwing from `execute()`; senpi's
  `AgentToolResult` has no `isError` field and the agent loop only marks an error
  on throw (`agent-loop.ts` `executePreparedToolCall`).
- UI simplified to a single `ctx.ui.setStatus("goal", …)` footer segment instead
  of pi-goal's full footer-replacement component.

### Why extension system couldn't handle this differently
- Implemented entirely as a builtin extension via the public `pi.*` API
  (`registerTool`, `registerCommand`, `pi.on`, `sendMessage`) plus the
  `getAgentDir()` config helper. No change to `extensions/types.ts` or other core.

### Expected merge conflict zones on next upstream sync
- LOW: `builtin/index.ts` import block + `builtinExtensions` array if upstream
  reorders or adds builtins.
- NONE for `extensions/types.ts` (untouched).
