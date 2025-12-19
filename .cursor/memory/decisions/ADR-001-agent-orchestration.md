# ADR-001: Agent Orchestration Pattern

**Status**: Accepted  
**Date**: 2025-12-17  
**Deciders**: Project maintainer

## Context

OhMyOpenCode needed a strategy for leveraging multiple AI models. Challenges: model specialization, context management, task routing, and coordination.

## Decision

**Hierarchical Orchestration** with OmO (Claude Opus 4.5) as primary orchestrator delegating to specialized subagents.

| Agent | Model | Purpose |
|-------|-------|---------|
| OmO | Claude Opus 4.5 | Orchestration, reasoning |
| Oracle | GPT-5.2 | Architecture, review |
| Explore | Grok-Code | Fast code search |
| Librarian | Claude Sonnet | External docs |
| Frontend | Gemini 3 Pro | UI/visual |

## Rationale

Each model excels at different tasks. Hierarchical delegation provides clear responsibility while enabling parallelism via background tasks.

## Consequences

### Positive
- Optimal model matching per task
- Cost efficiency (cheaper models for simple tasks)
- Parallelism via background_task()
- Clear agent responsibilities

### Negative
- More complexity than single-model
- Context loss in delegation
- Debugging across agent boundaries harder

## Alternatives Considered

- **Single Model**: Rejected - doesn't leverage model strengths
- **Round-Robin**: Rejected - no task-model matching
- **Peer-to-Peer**: Rejected - coordination complexity

## Notes

See full ADR: `docs/architecture/decisions/ADR-001-agent-orchestration.md`
