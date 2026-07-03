# builtin/goal

Builtin extension #16. Persistent per-thread **goal** tracking, ported from the
standalone `pi-goal` extension with **zero dependency on it** and the **budget
concept fully removed**. Registers the codex-aligned `create_goal` /
`update_goal` / `get_goal` tools plus a `/goal` command, persists a single goal
per thread to a JSON file, and re-engages the agent toward an active goal via
hidden continuation prompts.

## FILES

```
goal/
├── index.ts          # Extension entry — tools + /goal command + session/agent lifecycle + usage accounting
├── store.ts          # File persistence: read/write/create/update/clear/accountGoalUsage
├── types.ts          # Goal, GoalStatus (active|paused|complete), GoalFile, GoalStoreRef, GoalUpdate, snapshots
├── validation.ts     # validateObjective (trim + max length)
├── continuation.ts   # shouldQueueGoalContinuation* gating predicates
├── prompt.ts         # buildContinuationPrompt (untrusted-objective + completion audit)
├── format.ts         # Tool/UI formatting + goalToolResponse snapshot
├── command.ts        # parseGoalCommand (show|pause|resume|clear|setObjective)
├── ui.ts             # ctx.ui.setStatus footer segment for the active goal
├── errors.ts         # Goal{AlreadyExists,NotFound}/store error classes
└── changes.md        # Fork tracker (port + budget removal)
```

## NO BUDGET

This is the deliberate divergence from `pi-goal` / codex `ext/goal`. There is no
`tokenBudget`, no `budgetLimited`/`usageLimited` status, no budget-limit
continuation, and no budget-driven status transition. `tokensUsed` and
`timeUsedSeconds` are retained as display-only usage metrics. Status is exactly
`active | paused | complete`.

## PERSISTENCE

`store.ts` writes `GoalFile{version:1, goal}` to
`<sessionDir>/extensions/goal/<threadId>.json`, falling back to
`getAgentDir()/extensions/goal/no-session/<sha256(cwd)[:24]>/` when the session
has no file (in-memory / print mode). One goal per thread.

## ERRORS

Tool error results are signaled by **throwing** from `execute()` — senpi's
`AgentToolResult` has no `isError` field and the agent loop only marks a result
as an error when the tool throws (`agent-loop.ts` `executePreparedToolCall`).
Do not return an `isError` property; it is ignored.

## WHERE TO LOOK

| Task | File |
|------|------|
| Change a tool schema or description | `index.ts` `registerTool` |
| Adjust status transitions / persistence | `store.ts` |
| Tune the continuation prompt | `prompt.ts` |
| Change the footer status text | `ui.ts` |
| `/goal` argument parsing | `command.ts` |

## CONVENTIONS

- **Single goal per thread.** `create_goal` fails (throws) if one already exists;
  use `update_goal` only to mark complete. `/goal <objective>` replaces with a UI
  confirm.
- **Continuation is opt-in by state**: hidden prompts are queued only while a goal
  is `active`, idle, and there are no pending messages.
- **Usage accounting is display-only**: `accountGoalUsage` increments
  `tokensUsed`/`timeUsedSeconds`; it never changes status.

## NOTES

- Tests: `test/suite/goal-store.test.ts`, `goal-modules.test.ts`,
  `goal-extension.test.ts` (faux/mocked `pi`, temp-file store, no real APIs).
- Registered last in `builtin/index.ts` `builtinExtensions`; inert until a goal
  is created.
