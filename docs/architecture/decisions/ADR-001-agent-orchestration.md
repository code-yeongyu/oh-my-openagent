---
title: "ADR-001: Agent Orchestration Pattern"
description: "Architecture decision record for the multi-model agent orchestration approach"
status: "accepted"
date: "2025-12-17"
---

# ADR-001: Agent Orchestration Pattern

## Status

**Accepted**

## Context

OhMyOpenCode (OMO) needed a strategy for leveraging multiple AI models to handle diverse software engineering tasks. The challenges included:

1. **Model Specialization**: Different models excel at different tasks (reasoning vs. speed vs. cost)
2. **Context Management**: Preserving context across delegations while avoiding context window overflow
3. **Task Routing**: Determining which model/agent should handle which type of work
4. **Coordination**: Managing parallel and sequential agent workflows

### Options Considered

1. **Single Model Approach**: Use one model (e.g., Claude) for everything
2. **Round-Robin**: Rotate between models for load balancing
3. **Hierarchical Orchestration**: Primary orchestrator delegates to specialized subagents
4. **Peer-to-Peer**: Agents communicate directly without central coordination

## Decision

We chose **Hierarchical Orchestration** with OmO (Claude Opus 4.5) as the primary orchestrator.

### Architecture

```
                    ┌─────────────────┐
                    │      User       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │       OmO       │  ← Primary Orchestrator
                    │ (Claude Opus)   │     - Intent classification
                    │                 │     - Task planning
                    └────────┬────────┘     - Delegation decisions
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│    Oracle     │   │   Explore     │   │  Librarian    │
│  (GPT-5.2)    │   │ (Grok-Code)   │   │(Claude Sonnet)│
│               │   │               │   │               │
│ Architecture  │   │ Code Search   │   │ External Docs │
│ Code Review   │   │ Pattern Find  │   │ GitHub Search │
└───────────────┘   └───────────────┘   └───────────────┘
```

### Model Selection Rationale

| Agent | Model | Why This Model |
|-------|-------|----------------|
| **OmO** | Claude Opus 4.5 | Best reasoning for orchestration, extended thinking |
| **Oracle** | GPT-5.2 | Strong analytical reasoning for architecture |
| **Explore** | Grok-Code | Fast, cheap, good at code patterns |
| **Librarian** | Claude Sonnet 4.5 | Good at synthesis, documentation |
| **Frontend** | Gemini 3 Pro | Strong at UI/visual understanding |
| **Document Writer** | Gemini 3 Pro | Good at structured writing |
| **Multimodal Looker** | Gemini 2.5 Flash | Fast multimodal processing |

### Delegation Mechanisms

1. **`task()`**: Synchronous delegation - OmO waits for result
   - Used for: Oracle consultations, Frontend work, Document writing
   
2. **`background_task()`**: Asynchronous delegation - fire and forget
   - Used for: Explore (parallel code search), Librarian (parallel doc lookup)
   
3. **`look_at()`**: Specialized multimodal delegation
   - Used for: Image/PDF analysis via multimodal-looker

## Consequences

### Positive

- **Optimal Model Matching**: Each task uses the best-suited model
- **Cost Efficiency**: Cheaper models for simpler tasks (explore, librarian)
- **Parallelism**: Background tasks enable concurrent exploration
- **Clear Responsibility**: Each agent has defined scope and restrictions
- **Extensibility**: New agents can be added without changing core architecture

### Negative

- **Complexity**: More moving parts than single-model approach
- **Context Loss**: Subagents don't inherit full conversation context
- **Latency**: Delegation adds overhead vs. direct execution
- **Debugging**: Harder to trace issues across agent boundaries

### Mitigations

- **7-Section Prompt Structure**: Ensures subagents receive sufficient context
- **Tool Restrictions**: Prevents subagents from recursive delegation
- **Background Notifications**: Parent session notified when tasks complete
- **Todo Tracking**: Obsessive task management prevents lost work

## References

- [Agent System Documentation](/architecture/02-agent-system)
- [Background Task System](/architecture/03-background-tasks)
- Source: `src/agents/omo.ts`, `src/agents/index.ts`
