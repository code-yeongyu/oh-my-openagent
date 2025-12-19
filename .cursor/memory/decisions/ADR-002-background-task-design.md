# ADR-002: Background Task Design

**Status**: Accepted  
**Date**: 2025-12-17  
**Deciders**: Project maintainer

## Context

OmO needed to delegate long-running tasks (code exploration, doc lookup) without blocking the primary conversation. Requirements: non-blocking execution, result collection, progress tracking, cancellation.

## Decision

**Child Sessions with Polling** using OpenCode's session API.

1. `background_task()` creates child session with `parentID`
2. BackgroundManager polls every 2 seconds
3. Task complete when session idle AND all todos done
4. Dual notification: TUI toast + parent prompt injection

## Rationale

OpenCode's session architecture naturally supports isolation. Polling is simple and reliable. Todo verification prevents premature completion.

## Consequences

### Positive
- True parallelism (multiple concurrent tasks)
- Non-blocking parent execution
- Progress visibility via `background_output`
- Cancellable via `background_cancel`

### Negative
- 2-second polling latency
- Session proliferation with many tasks
- Child sessions lack parent's full context

## Alternatives Considered

- **Thread-Based**: Rejected - OpenCode is session-based
- **Queue-Based (Redis)**: Rejected - adds external dependency
- **Streaming**: Rejected - agents produce structured final outputs

## Notes

See full ADR: `docs/architecture/decisions/ADR-002-background-task-design.md`
Source: `src/features/background-agent/manager.ts`
