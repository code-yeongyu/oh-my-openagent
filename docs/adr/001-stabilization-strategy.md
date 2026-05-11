# ADR-001: Architectural Stabilization & Decoupling Strategy

## Status
**Proposed** | **Priority: Critical**

## Context: The Barrel-Cycle Trap
The `oh-my-openagent` codebase currently suffers from **99 circular dependency chains**. This systemic entanglement prevents predictable initialization, increases bundle sizes, and complicates automated testing. 

The primary cause is the **"Barrel-Cycle Trap"** centered on `src/shared/index.ts`. As a central "God Node," nearly every file in the project imports from this barrel. However, multiple utility files *within* the `src/shared/` directory also import from the same barrel to access sibling utilities, creating immediate recursive loops.

### The "Mega Cycle" (Cycle 4)
One of the most damaging chains is **Cycle 4**, which connects the core infrastructure to high-level features and back:
`shared/index` → `shared/migration` → `agent-category` → `delegate-task/constants` → `dynamic-agent-prompt-builder` → `agents/types` → `agents/index` → `builtin-agents` → `opencode-skill-loader` → `skill-mcp-manager` → `mcp-oauth/provider` → `mcp-oauth/storage` → **Back to `shared/index`**.

This cycle ensures that changing a low-level migration utility can theoretically trigger side effects in the OAuth storage or Agent Prompt logic, breaking the principle of least astonishment.

---

## Decision: Leaf-First Decoupling Protocol
To stabilize the architecture, we will implement a "Leaf-First" decoupling strategy, forcing a hierarchical dependency structure where "Leaf Nodes" (utilities) are strictly isolated from "Orchestration Nodes" (barrels).

### Rule #1: Internal Isolation
Files located within `src/shared/` and `src/agents/` are **strictly forbidden** from importing their own `index.ts` barrel (e.g., `import { ... } from "."` or `import { ... } from "../shared"`). 
*   **Mandate:** Use direct relative path imports (e.g., `import { log } from "./logger"`).

### Rule #2: Mathematical Sovereignty (The Base Layer)
We will isolate nodes with the highest **Betweenness Centrality** into a dedicated **Base Layer** (`src/shared/base/`). These nodes represent the "connective tissue" of the system.
*   **Target Nodes:** `log()`, `GET()`, `now()`.
*   **Constraint:** Files in the Base Layer must have **zero** internal project dependencies. They may only import from external standard libraries (e.g., `node:fs`) or literal-only sinks.
*   **Error Governance:** All Base Layer utilities MUST use `SovereignError` for failure reporting. Silent masking is strictly forbidden.

### Rule #3: Pure Type Isolation
Shared interfaces and types will be migrated to `src/shared/types/`.
*   **Constraint:** This directory must remain "pure" (type-only, zero executable logic). 
*   **Constraint:** Zero imports from other project directories.

---

## Technical Enforcement & Tooling

### `ast-grep` Boundary Enforcement
We will integrate `ast-grep` into CI to enforce the isolation of the Base Layer and prevent barrel-import regressions.

**Rule: Base Layer Isolation (ast-grep)**
```yaml
id: base-layer-isolation
language: typescript
rule:
  pattern: import { $$$ } from "$SOURCE"
  regex:
    SOURCE: "^(?!node:|fs|os|path|@opencode-ai/sdk).*"
  inside:
    path: src/shared/base/**
message: "Base Layer nodes must have zero internal project dependencies."
```

**Rule: Prevent internal shared imports from barrel**
```yaml
id: prevent-shared-index-import
language: typescript
rule:
  pattern: import { $$$ } from "./index"
  inside:
    path: src/shared/**
message: "Internal utilities must not import from the shared barrel. Use direct file imports."
```

---

## Consequences
*   **Positive:** Faster initialization, zero "undefined" export bugs, cleaner dependency graphs.
*   **Negative:** Developers must use longer relative paths (e.g., `../../shared/base/logger`) when working deep in the feature tree.
