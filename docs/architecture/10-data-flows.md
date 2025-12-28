---
title: "Data Flows"
description: "Visual representation of data flows and component interactions within the OhMyOpenCode plugin."
---

# Data Flows

This document provides a comprehensive visual guide to the data flows and component interactions within the OhMyOpenCode (OMO) plugin. These diagrams establish the architectural baseline for the system.

## 1. Plugin Initialization Flow

The initialization flow occurs when the OpenCode CLI loads the plugin. It involves loading configurations, instantiating hooks and managers, and registering tools.

```mermaid
flowchart TD
    A[OpenCode CLI] -->|Load Plugin| B[OhMyOpenCodePlugin]
    B --> C[Load Configs]
    C --> D[User Config: ~/.config/opencode/...]
    C --> E[Project Config: .opencode/...]
    D --> F[Merge Configs: Deep Merge]
    E --> F
    F --> G[Initialize Hooks: Conditional creation]
    G --> H[Create BackgroundManager]
    H --> I[Create Tools: Builtin + Custom + Governance]
    I --> J[Return Plugin Interface]
    J --> K[Config Callback: Load Agents/MCPs/Commands]
```

## 2. Request Processing Flow

This diagram shows how a user request flows through the system, including hook interception and agent processing.

```mermaid
sequenceDiagram
    participant U as User
    participant P as Plugin
    participant H as chat.message hooks
    participant A as Agent (OmO)
    participant T as Tool System
    
    U->>P: User Message
    P->>H: chat.message event
    H->>H: Linear Injector (Context)
    H->>H: Keyword Detector
    H-->>P: Modified Prompt
    P->>A: Process Message
    A->>T: Tool Call (e.g., read, grep)
    T-->>A: Tool Result
    A->>P: Final Response
    P->>U: Display Message
```

## 3. Tool Execution Flow

Tool execution is wrapped in `before` and `after` hooks to provide governance, safety, and utility functions.

```mermaid
sequenceDiagram
    participant U as User/Agent
    participant P as Plugin
    participant B as tool.execute.before hooks
    participant T as Tool
    participant A as tool.execute.after hooks
    
    U->>P: Tool call
    P->>B: Execute before hooks
    B->>B: Claude Code Hooks
    B->>B: Non-Interactive Env
    B->>B: Comment Checker
    B->>B: Governance Path Validator
    B-->>P: Proceed/Block
    P->>T: Execute tool
    T->>A: Tool result
    A->>A: Tool Output Truncator
    A->>A: Rules/README Injector
    A->>A: Governance Historian
    A-->>P: Modified result
    P->>U: Final result
```

## 4. Agent Orchestration Flow

OmO acts as the primary orchestrator, delegating specialized tasks to subagents using different mechanisms.

```mermaid
flowchart TD
    A[User Request] --> B[OmO Agent]
    B --> C{Delegation Type?}
    C -->|task: Synchronous| D[Oracle: Architecture]
    C -->|task: Synchronous| E[Frontend: UI/UX]
    C -->|task: Synchronous| F[Document Writer: Docs]
    C -->|background_task: Async| G[Explore: Code Search]
    C -->|background_task: Async| H[Librarian: External Docs]
    C -->|look_at: Multimodal| I[Multimodal Looker: Media]
    
    D & E & F --> J[Return Result to OmO]
    G & H --> K[Notify OmO when done]
    I --> J
```

## 5. Background Task Flow

The `BackgroundManager` manages the lifecycle of asynchronous tasks, ensuring they complete their todos before notifying the parent.

```mermaid
stateDiagram-v2
    [*] --> Launching: background_task()
    Launching --> Running: Session created
    Running --> Running: Polling (2s)
    Running --> CheckingTodos: session.idle
    CheckingTodos --> Running: Incomplete todos
    CheckingTodos --> Completed: All todos done
    Running --> Error: API error
    Running --> Cancelled: background_cancel()
    Completed --> Notifying: notifyParentSession()
    Error --> Notifying
    Notifying --> [*]
```

## 6. Session Recovery Flow

The recovery system detects structural errors in AI responses and applies automated fixes to maintain session continuity.

```mermaid
sequenceDiagram
    participant S as OpenCode Session
    participant R as Session Recovery Hook
    participant FS as Filesystem (Storage)
    participant C as OpenCode Client
    
    S->>R: session.error (e.g., tool_result_missing)
    R->>R: Detect Error Type
    R->>C: session.abort()
    R->>FS: Read/Fix Message Parts
    R->>C: Apply Fix (Inject parts)
    R->>C: session.prompt("continue")
    C-->>S: Session Resumed
```

## 7. Governance Data Flow

The governance system ensures all actions are compliant and traceable.

```mermaid
flowchart TD
    subgraph Input
        A[User Message]
        B[Tool Call]
    end
    
    subgraph Linear Injector
        A --> C{Contains LIF-XXX?}
        C -->|Yes| D[Fetch via Linear API]
        D --> E[Inject <linear_context>]
    end
    
    subgraph Path Validator
        B --> F{write/edit?}
        F -->|Yes| G{Valid Path?}
        G -->|No + Block| H[Throw Error]
        G -->|Yes| I[Execute Tool]
    end
    
    subgraph Historian
        I --> J[Track Changes]
        J --> K{Session End?}
        K -->|Yes| L[Create Changelog Entry]
    end
```

## 8. Hook Chain Flow

Hooks are executed in a specific sequence to ensure correct interaction between different features.

```mermaid
flowchart LR
    E[Event Triggered] --> H1[Claude Code Hooks]
    H1 --> H2[Utility Hooks]
    H2 --> H3[Context Injectors]
    H3 --> H4[Governance Hooks]
    H4 --> A[Final Action]
    
    subgraph "tool.execute.before Chain"
    B1[Claude Code] --> B2[Non-Interactive Env]
    B2 --> B3[Comment Checker]
    B3 --> B4[Path Validator]
    end
```

## 9. Configuration Loading Flow

Configurations are merged from multiple levels to allow for global defaults and project-specific overrides.

```mermaid
flowchart TD
    A[User Config: ~/.config/...] --> C[Deep Merge]
    B[Project Config: .opencode/...] --> C
    C --> D[Zod Validation]
    D --> E{Valid?}
    E -->|No| F[Log Error + Use Defaults]
    E -->|Yes| G[Final Plugin Config]
    G --> H[Initialize Components]
```

## 10. Context Injection Flow

Context is dynamically injected into tool outputs to provide the agent with relevant project knowledge.

```mermaid
flowchart TD
    A[Tool Output] --> B[Rules Injector: .cursorrules]
    B --> C[README Injector: README.md]
    C --> D[Agent Injector: AGENTS.md]
    D --> E[Truncators: Truncate if too large]
    E --> F[Final Contextualized Output]
```
