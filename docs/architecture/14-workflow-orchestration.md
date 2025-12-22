---
title: "Workflow Orchestration"
description: "How workflow commands delegate to specialized agents via the call_omo_agent tool"
---

# Workflow Orchestration

OhMyOpenCode implements a structured development workflow where each phase is managed by a specialized agent. This orchestration is triggered by workflow commands and coordinated by **OmO** (the primary orchestrator) using the `call_omo_agent` tool.

## Workflow Commands

The system defines six primary workflow commands that guide a feature from specification to testing:

| Command | Specialist Agent | Phase | Output |
|---------|------------------|-------|--------|
| `/specify` | `product-strategist` | Specification | `spec.md` |
| `/plan` | `strategic-planner` | Planning | `plan.md` |
| `/tasks` | `task-planner` | Task Breakdown | `tasks.md` |
| `/implement` | `implementation-specialist` | Implementation | Source Code |
| `/review` | `oracle` | Review | Review Report |
| `/test` | `test-specialist` | Testing | Test Suite |

## Delegation Mechanism

Workflow commands are loaded as markdown instructions that guide OmO to delegate the actual work. Since LIF-72, these specialists are built-in TypeScript agents, allowing for better type safety, tool integration, and performance.

### call_omo_agent Tool
OmO uses the `call_omo_agent` tool to delegate tasks synchronously. This tool:
1. Instantiates the specialized agent with its unique system prompt and toolset.
2. Manages a sub-session for the specialist's execution.
3. Returns the specialist's final output and modified files back to OmO.

## Orchestration Sequences

### Specification Phase (`/specify`)

```mermaid
sequenceDiagram
    participant User
    participant OmO
    participant PS as product-strategist
    participant Script as create-feature.sh
    
    User->>OmO: /specify "Add dark mode"
    OmO->>Script: Execute (Create spec folder)
    Script-->>OmO: Spec folder path (LIF-123-feat-dark-mode)
    OmO->>OmO: call_omo_agent(subagent_type="product-strategist", prompt="...")
    OmO->>PS: Adopt Persona & Create spec.md
    PS-->>OmO: spec.md created
    OmO-->>User: Report completion & spec path
```

### Planning Phase (`/plan`)

```mermaid
sequenceDiagram
    participant User
    participant OmO
    participant SP as strategic-planner
    participant Context as read_context
    
    User->>OmO: /plan
    OmO->>OmO: Preflight check (requires spec.md)
    OmO->>Context: Get architecture & tech stack
    Context-->>OmO: Project context
    OmO->>OmO: call_omo_agent(subagent_type="strategic-planner", prompt="...")
    OmO->>SP: Design architecture & plan.md
    SP-->>OmO: plan.md created
    OmO-->>User: Report completion & plan path
```

### Task Phase (`/tasks`)

```mermaid
sequenceDiagram
    participant User
    participant OmO
    participant TP as task-planner
    
    User->>OmO: /tasks
    OmO->>OmO: Preflight check (requires plan.md)
    OmO->>OmO: call_omo_agent(subagent_type="task-planner", prompt="...")
    OmO->>TP: Break down plan into tasks.md
    TP-->>OmO: tasks.md created
    OmO-->>User: Report completion & tasks path
```

### Implementation Phase (`/implement`)

```mermaid
sequenceDiagram
    participant User
    participant OmO
    participant IS as implementation-specialist
    participant Specialist as Domain Specialist (TS/Rust/etc.)
    
    User->>OmO: /implement
    OmO->>OmO: Preflight check (requires tasks.md)
    OmO->>OmO: call_omo_agent(subagent_type="implementation-specialist", prompt="...")
    OmO->>IS: Coordinate implementation
    IS->>IS: Select Domain Specialist
    IS->>Specialist: Delegate coding task
    Specialist-->>IS: Implementation complete
    IS-->>OmO: All tasks completed
    OmO-->>User: Report completion
```

## Workflow Continuity

### State Persistence
After each phase, OmO calls `update_workflow_state` to persist:
- The completed step
- Artifact hashes (for drift detection)
- Linear issue status

### Resume Mechanism
If a session is restarted, the `commandPreflight` tool reads the persisted state and provides a resume message, allowing OmO to understand where it left off in the workflow.
