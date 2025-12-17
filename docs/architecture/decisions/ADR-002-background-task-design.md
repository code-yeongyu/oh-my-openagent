---
title: "ADR-002: Background Task Design"
description: "Architecture decision record for asynchronous agent execution via child sessions"
status: "accepted"
date: "2025-12-17"
---

# ADR-002: Background Task Design

## Status

**Accepted**

## Context

OmO needed the ability to delegate long-running tasks (code exploration, documentation lookup) without blocking the primary conversation. The challenges included:

1. **Non-Blocking Execution**: Parent agent must continue working while tasks run
2. **Result Collection**: Results must be retrievable when needed
3. **Progress Tracking**: Users and parent agents need visibility into task status
4. **Resource Management**: Tasks must be cancellable and have proper cleanup

### Options Considered

1. **Thread-Based**: Run agents in separate threads within same process
2. **Queue-Based**: Push tasks to a job queue (Redis, etc.)
3. **Child Session**: Create separate OpenCode sessions for background work
4. **Streaming**: Stream partial results back to parent

## Decision

We chose **Child Sessions with Polling** using OpenCode's session API.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Parent Session                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │ OmO: "I'll search the codebase in background"   │    │
│  │ → background_task(agent="explore", prompt="...") │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ BackgroundManager.launch()                       │    │
│  │ 1. client.session.create(parentID: parentSession)│    │
│  │ 2. client.session.promptAsync(prompt, agent)     │    │
│  │ 3. Start polling loop (2s interval)              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Child Session                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Explore Agent: Searching codebase...             │    │
│  │ → grep, glob, ast_grep, read                     │    │
│  │ → Building response...                           │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼ (session.idle + todos complete)
┌─────────────────────────────────────────────────────────┐
│                   Notification                           │
│  1. TUI Toast: "Background task completed"              │
│  2. Parent Prompt: "[BACKGROUND TASK COMPLETED]..."     │
└─────────────────────────────────────────────────────────┘
```

### Task Lifecycle

```
[*] ──launch()──► Running ──polling(2s)──► Running
                     │                        │
                     │ session.idle           │ error
                     │ + todos done           │
                     ▼                        ▼
                 Completed                  Error
                     │                        │
                     └────► notifyParent ◄────┘
```

### Key Design Decisions

1. **Polling Interval**: 2 seconds
   - Fast enough for responsive UX
   - Slow enough to avoid API rate limits

2. **Todo Verification**: Task not complete until all todos are done
   - Prevents premature completion notifications
   - Ensures agents finish their planned work

3. **Tool Restrictions**: Child sessions cannot use `task` or `background_task`
   - Prevents infinite recursion
   - Keeps delegation tree shallow

4. **Dual Notification**: Toast + Parent prompt
   - Toast for user awareness
   - Parent prompt for agent awareness

## Consequences

### Positive

- **True Parallelism**: Multiple background tasks can run simultaneously
- **Non-Blocking**: Parent continues working immediately
- **Visibility**: Progress tracking via `background_output`
- **Cancellable**: Tasks can be aborted via `background_cancel`
- **Clean Separation**: Child sessions have isolated state

### Negative

- **Polling Overhead**: 2-second intervals add latency to completion detection
- **Session Proliferation**: Many background tasks create many sessions
- **Context Isolation**: Child sessions don't share parent's full context
- **Complexity**: More infrastructure than simple function calls

### Mitigations

- **Todo Checking**: Prevents false completion signals
- **Session Cleanup**: Sessions cleaned up on task completion
- **Rich Prompts**: 7-section structure provides sufficient context
- **Progress Tracking**: `background_output` shows intermediate state

## Alternatives Rejected

### Thread-Based Execution
- **Rejected because**: OpenCode's architecture is session-based; threads would require significant infrastructure changes

### Queue-Based (Redis)
- **Rejected because**: Adds external dependency; OpenCode sessions already provide isolation

### Streaming Results
- **Rejected because**: Agents produce structured final outputs; streaming partial results adds complexity without clear benefit

## References

- [Background Task Documentation](/architecture/03-background-tasks)
- Source: `src/features/background-agent/manager.ts`
- Source: `src/tools/background-task/tools.ts`
