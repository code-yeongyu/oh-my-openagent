# Matrixx Agent Architecture

## System Overview

```mermaid
graph TB
    subgraph USER["👤 User"]
        UI["OpenCode UI<br/>(Agent Selection)"]
    end

    subgraph PRIMARY["Primary Agents (mode: primary)"]
        MOR["🔴 Morpheus<br/>Claude Opus 4.6<br/><i>Main Orchestrator</i>"]
        KEY["🟡 Keymaker<br/>GPT 5.3 Codex<br/><i>Autonomous Deep Worker</i>"]
        ARC["🟣 Architect<br/>Claude Sonnet 4.6<br/><i>Plan Execution Orchestrator</i>"]
    end

    subgraph SPECIALIST["Specialist Agents (mode: all)"]
        CIP["🔵 Cipher<br/>Claude Sonnet 4.6<br/><i>DSL Engineering</i><br/>11 skills"]
        SAT["🎨 Sati<br/>Claude Sonnet 4.6<br/><i>Frontend Specialist</i><br/>7 skills"]
    end

    subgraph ADVISORS["Advisory Agents (mode: subagent)"]
        ORA["📋 Oracle<br/>Claude Opus 4.6<br/><i>Strategic Planning</i>"]
        MER["🏛️ Merovingian<br/>Claude Sonnet 4.6<br/><i>Architecture & Debugging</i>"]
        SER["👁️ Seraph<br/>Claude Opus 4.6<br/><i>Pre-Planning Analysis</i>"]
        SMI["⚔️ Smith<br/>Claude Sonnet 4.6<br/><i>Plan Validation</i>"]
        SEN["🛡️ Sentinel<br/>Claude Sonnet 4.6<br/><i>Security Auditor</i><br/>9 skills"]
    end

    subgraph EXPLORERS["Exploration Agents (mode: subagent)"]
        TRI["⚡ Trinity<br/>Claude Haiku 4.5<br/><i>Codebase Grep</i>"]
        OPR["📚 Operator<br/>Claude Haiku 4.5<br/><i>Docs & OSS Search</i>"]
        CON["👀 Construct<br/>Claude Sonnet 4.6<br/><i>Multimodal Analysis</i>"]
    end

    subgraph EXECUTOR["Dynamic Executor"]
        MOU["🐭 Mouse<br/>Claude Sonnet 4.6<br/><i>Category-Spawned Worker</i>"]
    end

    UI --> MOR
    UI --> KEY
    UI --> ARC
    UI -.->|"@cipher"| CIP
    UI -.->|"@sati"| SAT
    UI -.->|"@sentinel"| SEN

    MOR ==>|"task(subagent_type)"| ORA
    MOR ==>|"task(subagent_type)"| MER
    MOR ==>|"task(subagent_type)"| SER
    MOR ==>|"task(subagent_type)"| SMI
    MOR ==>|"task(subagent_type)"| SAT
    MOR ==>|"task(subagent_type)"| SEN
    MOR ==>|"task(subagent_type)"| TRI
    MOR ==>|"task(subagent_type)"| OPR
    MOR ==>|"task(subagent_type)"| CON
    MOR ==>|"task(category)"| MOU

    style MOR fill:#e74c3c,color:#fff
    style KEY fill:#f39c12,color:#fff
    style ARC fill:#9b59b6,color:#fff
    style CIP fill:#3498db,color:#fff
    style ORA fill:#e67e22,color:#fff
    style MER fill:#8e44ad,color:#fff
    style SER fill:#2ecc71,color:#fff
    style SMI fill:#c0392b,color:#fff
    style TRI fill:#1abc9c,color:#fff
    style OPR fill:#2980b9,color:#fff
    style CON fill:#d35400,color:#fff
    style SAT fill:#e91e63,color:#fff
    style SEN fill:#2c3e50,color:#fff
    style MOU fill:#7f8c8d,color:#fff
```

## Delegation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant M as Morpheus
    participant BG as BackgroundManager
    participant T as Trinity/Operator
    participant O as Oracle
    participant MO as Mouse
    participant S as Smith

    U->>M: "Add JWT auth to our API"

    Note over M: Phase 0: Intent Classification<br/>→ Open-ended task, 2+ modules

    par Parallel Exploration (Background)
        M->>BG: task(subagent="trinity", background=true)
        BG->>T: Find auth patterns in codebase
        M->>BG: task(subagent="operator", background=true)
        BG->>T: Find JWT best practices
    end

    Note over M: Continue working while agents explore

    M->>BG: background_output(task_id)
    BG-->>M: Search results

    Note over M: Phase 1: Codebase Assessment<br/>→ Disciplined codebase, follow patterns

    Note over M: Phase 2A: Create todo list

    M->>O: task(subagent="oracle")<br/>Create work plan
    O-->>M: Structured plan

    M->>S: task(subagent="smith")<br/>Review plan
    S-->>M: Plan validated ✓

    Note over M: Phase 2B: Execute plan

    loop For each todo item
        alt Simple change
            M->>M: Direct implementation
        else Complex module work
            M->>MO: task(category="source")<br/>Implement auth middleware
            MO-->>M: Implementation complete
        end
        Note over M: Mark todo complete
    end

    Note over M: Phase 3: Verify & Report
    M-->>U: Done. All items complete.
```

## Delegation Mechanism

```mermaid
flowchart LR
    subgraph TASK_TOOL["task() Tool"]
        direction TB
        CAT["category=<br/>'source'"]
        SUB["subagent_type=<br/>'trinity'"]
        BG["run_in_background=<br/>true/false"]
        SID["session_id=<br/>'ses_...'"]
        SK["load_skills=<br/>['git-master']"]
    end

    subgraph ROUTING["Category Router"]
        direction TB
        R1["construct → Frontend/UI"]
        R2["source → Hard logic"]
        R3["deep-jack → Goal-oriented"]
        R4["matrix-bend → Creative"]
        R5["bullet-time → Trivial"]
        R6["broadcast → Documentation"]
        R7["quick → Simple tasks"]
        R8["blue-pill → Low effort"]
        R9["red-pill → High effort"]
    end

    subgraph RESOLUTION["Agent Resolution"]
        direction TB
        RES1["Resolve model<br/>(fallback chain)"]
        RES2["Build prompt<br/>(category append)"]
        RES3["Inject skills<br/>(load_skills)"]
        RES4["Apply restrictions<br/>(denied tools)"]
    end

    subgraph EXECUTION["Execution Mode"]
        SYNC["Sync Session<br/>Poller waits<br/>for completion"]
        ASYNC["Background Task<br/>Returns task_id<br/>immediately"]
    end

    CAT --> ROUTING
    SUB --> RESOLUTION
    ROUTING --> RESOLUTION
    BG -->|false| SYNC
    BG -->|true| ASYNC
    RESOLUTION --> SYNC
    RESOLUTION --> ASYNC
```

## Skill Injection Architecture

```mermaid
graph TD
    subgraph SKILL_REGISTRY["Skill Registry (31 Built-in Skills)"]
        subgraph DSL_SKILLS["Cipher's DSL Skills (11)"]
            S1["dsl-core"]
            S2["dsl-grammar"]
            S3["dsl-codegen"]
            S4["dsl-metamodel"]
            S5["dsl-tooling"]
            S6["dsl-textx-ecosystem"]
            S7["dsl-pyecore-advanced"]
            S8["dsl-model-transformation"]
            S9["dsl-testing"]
            S10["dsl-validation"]
            S11["dsl-composition"]
        end

        subgraph GENERAL_SKILLS["General Skills (17+)"]
            G1["playwright"]
            G2["git-master"]
            G3["frontend-ui-ux"]
            G4["dev-browser"]
            G5["security-core"]
            G6["security-sast"]
        end
    end

    subgraph AGENTS["Agent Skill Loading"]
        CIP_AGENT["Cipher Agent<br/><b>Auto-loads 11 DSL skills</b>"]
        MOUSE_AGENT["Mouse Agent<br/><b>Loads skills from load_skills[]</b>"]
    end

    DSL_SKILLS -.->|"built into factory"| CIP_AGENT
    GENERAL_SKILLS -.->|"via load_skills param"| MOUSE_AGENT
    DSL_SKILLS -.->|"via load_skills param"| MOUSE_AGENT
```

## Tool Restrictions

```mermaid
graph LR
    subgraph FULL_ACCESS["Full Tool Access"]
        FA1["Morpheus"]
        FA2["Keymaker"]
        FA3["Sati"]
        FA4["Mouse"]
    end

    subgraph READ_ONLY["Read-Only (no write/edit/task)"]
        RO1["Oracle"]
        RO2["Merovingian"]
        RO3["Sentinel"]
        RO4["Operator"]
        RO5["Trinity"]
    end

    subgraph VISION_ONLY["Vision Only (read only)"]
        VO1["Construct"]
    end

    subgraph NO_DELEGATION["No Delegation (no task)"]
        ND1["Cipher"]
        ND2["Mouse"]
    end

    TOOLS["26+ Tools<br/>LSP, AST-Grep, Grep,<br/>Glob, Read, Edit, Write,<br/>Bash, task(), background,<br/>session, look_at, skill"]

    TOOLS --> FULL_ACCESS
    TOOLS -.->|"filtered"| READ_ONLY
    TOOLS -.->|"minimal"| VISION_ONLY
    TOOLS -.->|"no task()"| NO_DELEGATION
```

## Agent Lifecycle & Model Resolution

```mermaid
flowchart TD
    CONFIG["matrixx.json Config"]
    OVERRIDES["Agent Overrides<br/>(model, variant, temp, etc.)"]
    PROVIDERS["Connected Providers<br/>(Anthropic, OpenAI, Google, etc.)"]

    CONFIG --> FACTORY["Agent Factory<br/>createXXXAgent(model)"]
    OVERRIDES --> FACTORY

    FACTORY --> RESOLVE["Model Resolution Pipeline"]
    PROVIDERS --> RESOLVE

    RESOLVE --> STEP1["1. User Override<br/>(config-specified model)"]
    STEP1 --> STEP2["2. Fallback Chain<br/>(try each until available)"]
    STEP2 --> STEP3["3. System Default<br/>(last resort)"]

    STEP3 --> BUILD["Build AgentConfig"]

    BUILD --> THINKING{"Model Type?"}
    THINKING -->|"Anthropic/Claude"| ANT["thinking: {<br/>  type: 'enabled',<br/>  budgetTokens: 32000<br/>}"]
    THINKING -->|"OpenAI/GPT"| GPT["reasoningEffort: 'medium'<br/>textVerbosity: 'high'"]
    THINKING -->|"Other"| OTHER["Default config"]

    ANT --> AGENT["Ready Agent"]
    GPT --> AGENT
    OTHER --> AGENT
```

## Execution Modes

```mermaid
flowchart TD
    TASK["task() call"]
    TASK --> MODE{"run_in_background?"}

    MODE -->|"false (default)"| SYNC["Sync Execution"]
    MODE -->|"true"| ASYNC["Async Execution"]

    SYNC --> S1["Create session"]
    S1 --> S2["Send prompt"]
    S2 --> S3["Poll for completion"]
    S3 --> S4{"Complete?"}
    S4 -->|"No"| S5{"Stall detected?"}
    S5 -->|"No"| S3
    S5 -->|"Yes<br/>(stability-based<br/>or timeout)"| S6["Force complete"]
    S4 -->|"Yes"| S7["Return result<br/>+ session_id"]

    ASYNC --> A1["Create session"]
    A1 --> A2["Send prompt"]
    A2 --> A3["Return task_id<br/>immediately"]
    A3 --> A4["Monitor in<br/>BackgroundManager"]
    A4 --> A5["Notify on<br/>completion"]
    A5 --> A6["background_output(task_id)<br/>to retrieve result"]

    S7 --> CONT{"Need follow-up?"}
    A6 --> CONT
    CONT -->|"Yes"| RESUME["task(session_id='ses_...')<br/>Full context preserved"]
    CONT -->|"No"| DONE["Done"]
```

## Agent Collaboration Patterns

| Pattern | Flow | Use Case |
|---------|------|----------|
| **Parallel Exploration** | Morpheus → Trinity + Operator (background) | Fast codebase + docs search simultaneously |
| **Plan → Review → Execute** | Morpheus → Oracle → Smith → Mouse | Complex multi-step features |
| **Pre-Analysis** | Morpheus → Seraph → Oracle | Ambiguous requirements needing scope clarification |
| **Consultation** | Morpheus → Merovingian | Architecture decisions, debugging after 2+ failures |
| **Frontend Specialist** | Morpheus → Sati | UI/UX implementation, browser automation, frontend testing |
| **Security Audit** | Morpheus → Sentinel | Vulnerability scanning, dependency CVEs, code audit |
| **Specialist Delegation** | Morpheus → Cipher | Domain-specific DSL work |
| **Category Work** | Morpheus → Mouse[category] | General task execution with category-optimized model |
| **Session Continuation** | Any agent → same agent (session_id) | Multi-turn follow-up preserving full context |
| **Autonomous Deep Work** | User → Keymaker | Complex tasks needing sustained autonomous execution |

## Key Design Principles

1. **Morpheus delegates, specialists execute** — Morpheus is the orchestrator, not the implementer
2. **Parallel by default** — Exploration agents always run in background
3. **Skills are composable** — Any agent can load any skill via `load_skills`
4. **Session continuity** — Every delegation returns a session_id for efficient follow-up
5. **Model fallback chains** — Every agent has a fallback chain for provider flexibility
6. **Tool restrictions enforce roles** — Read-only agents can't write; executors can't delegate
7. **Two-phase execution** — Sync (blocking) for critical path, async (background) for exploration
