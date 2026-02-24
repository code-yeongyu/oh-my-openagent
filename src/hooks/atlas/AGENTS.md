# src/hooks/atlas/ — Master Boulder Orchestrator

**Generated:** 2026-02-24

## OVERVIEW

17 files (~1976 LOC). The `atlasHook` — Continuation Tier hook that monitors session.idle events and forces continuation when boulder sessions (ralph-loop, task-spawned agents) have incomplete work. Also enforces write/edit policies for subagent sessions.

## WHAT ATLAS DOES

Atlas is the "keeper of sessions" — it tracks every session and decides:
1. Should this session be forced to continue? (if boulder session with incomplete todos)
2. Should write/edit be blocked? (policy enforcement for certain session types)
3. Should a verification reminder be injected? (after tool execution)

## DECISION GATE (session.idle)

```
session.idle event
  → Is this a boulder/ralph/atlas session? (session-last-agent.ts)
  → Is there an abort signal? (is-abort-error.ts)
  → Failure count < max? (state.promptFailureCount)
  → No running background tasks?
  → Agent matches expected? (recent-model-resolver.ts)
  → Plan complete? (todo status)
  → Cooldown passed? (5s between injections)
  → Inject continuation prompt (boulder-continuation-injector.ts)
```

## KEY FILES

| File | Purpose |
|------|---------|
| `atlas-hook.ts` | `createAtlasHook()` — composes event + tool handlers, maintains session state |
| `event-handler.ts` | `createAtlasEventHandler()` — decision gate for session.idle events |
| `boulder-continuation-injector.ts` | Build + inject continuation prompt into session |
| `system-reminder-templates.ts` | Templates for continuation reminder messages |
| `tool-execute-before.ts` | Block write/edit based on session policy |
| `tool-execute-after.ts` | Inject verification reminders post-tool |
| `write-edit-tool-policy.ts` | Policy: which sessions can write/edit? |
| `verification-reminders.ts` | Reminder content for verifying work |
| `session-last-agent.ts` | Determine which agent owns the session |
| `recent-model-resolver.ts` | Resolve model used in recent messages |
| `subagent-session-id.ts` | Detect if session is a subagent session |
| `sisyphus-path.ts` | Resolve `.sisyphus/` directory path |
| `is-abort-error.ts` | Detect abort signals in session output |
| `types.ts` | `SessionState`, `AtlasHookOptions`, `AtlasContext` |

## STATE PER SESSION

```typescript
interface SessionState {
  promptFailureCount: number  // Increments on failed continuations
  // Resets on successful continuation
}
```

Max consecutive failures before 5min pause: 5 (exponential backoff in todo-continuation-enforcer).

## RELATIONSHIP TO OTHER HOOKS

- **atlasHook** (Continuation Tier): Master orchestrator, handles boulder sessions
- **todoContinuationEnforcer** (Continuation Tier): "Boulder" mechanism for main Sisyphus sessions
- Both inject into session.idle but serve different session types
