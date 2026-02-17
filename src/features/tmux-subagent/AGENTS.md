# src/features/tmux-subagent/ — Tmux Pane Management

**Generated:** 2026-02-18

## OVERVIEW

28 files. State-first tmux integration managing panes for background agent sessions. Handles split decisions, grid planning, polling, and lifecycle events.

## CORE ARCHITECTURE

```
TmuxSessionManager (manager.ts)
  ├─→ DecisionEngine: Should we spawn/close panes?
  ├─→ ActionExecutor: Execute spawn/close/replace actions
  ├─→ PollingManager: Monitor pane health
  └─→ EventHandlers: React to session create/delete
```

## KEY FILES

| File | Purpose |
|------|---------|
| `manager.ts` | `TmuxSessionManager` — main class, session tracking, event routing |
| `decision-engine.ts` | Evaluate window state → produce `SpawnDecision` with actions |
| `action-executor.ts` | Execute `PaneAction[]` (close, spawn, replace) |
| `grid-planning.ts` | Calculate pane layout given window dimensions |
| `spawn-action-decider.ts` | Decide spawn vs replace vs skip |
| `spawn-target-finder.ts` | Find best pane to split or replace |
| `polling-manager.ts` | Health polling for tracked sessions |
| `types.ts` | `TrackedSession`, `WindowState`, `PaneAction`, `SpawnDecision` |

## PANE LIFECYCLE

```
session.created → spawn-action-decider → grid-planning → action-executor → track session
session.deleted → cleanup tracked session → close pane if empty
```

## LAYOUT CONSTRAINTS

- `MIN_PANE_WIDTH`: 52 chars
- `MIN_PANE_HEIGHT`: 11 lines
- Main pane preserved (never split below minimum)
- Agent panes split from remaining space

## EVENT HANDLERS

| File | Event |
|------|-------|
| `session-created-handler.ts` | New background session → spawn pane |
| `session-deleted-handler.ts` | Session ended → close pane |
| `session-created-event.ts` | Event type definition |
