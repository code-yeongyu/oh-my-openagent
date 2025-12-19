# Feature Specification: Orchestrator Research & Planning Agent Routing

**Feature ID**: `LIF-61-feat-orchestrator-research-planning-routing`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear Issue**: [LIF-61](https://linear.app/lifelogger/issue/LIF-61)  
**Input**: Improve orchestrator intent classification for research and planning agents

## Problem Statement

The orchestrator's intent classification system has a critical routing flaw: research and planning requests are not being routed to the appropriate specialized agents (`research`, `product-strategist`, `strategic-architect`). Instead, these requests fall through to incorrect agents or only trigger in multi-phase workflows.

### Current Behavior (Broken)

| User Request | Current Routing | Expected Routing |
|--------------|-----------------|------------------|
| "Research authentication options" | `project-guru` (CODEBASE_INQUIRY) | `research` |
| "Investigate Next.js App Router" | `project-guru` (CODEBASE_INQUIRY) | `research` |
| "Plan the user authentication feature" | Falls through or NEW_FEATURE | `product-strategist` |
| "Design the API architecture" | Falls through or NEW_FEATURE | `strategic-architect` |

### Root Causes

1. **Missing RESEARCH pattern**: The `research` agent is absent from the Keywords → Agent Mapping table and has no entry in the Intent Classification Decision Tree
2. **Keyword collision**: Keywords like "research", "investigate", "explore", "learn about" incorrectly match CODEBASE_INQUIRY pattern → `project-guru`
3. **Decision tree order bias**: CODEBASE_INQUIRY (line ~296) catches research-related keywords before they can be properly classified
4. **Planning agents only in workflows**: `product-strategist` and `strategic-architect` only trigger as Phase 1 of NEW_FEATURE workflows, not for standalone planning tasks
5. **No Research workflow pattern**: No defined workflow exists for pure research tasks

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Research Request Routing (Priority: P1)

As a user, when I ask the orchestrator to "research" or "investigate" a topic, I want it to delegate to the `research` agent so I get a comprehensive research report using DeepWiki, Context7, and web fetching capabilities.

**Why this priority**: This is the core fix - research requests must route to the research agent. Without this, the research agent is essentially unreachable through normal orchestrator routing.

**Independent Test**: Can be fully tested by sending "Research best practices for X" to orchestrator and verifying it delegates to `research` agent (not `project-guru`).

**Acceptance Scenarios**:

1. **Given** orchestrator receives request, **When** user says "Research authentication best practices", **Then** orchestrator delegates to `research` agent
2. **Given** orchestrator receives request, **When** user says "Investigate how Next.js App Router works", **Then** orchestrator delegates to `research` agent
3. **Given** orchestrator receives request, **When** user says "Explore options for state management", **Then** orchestrator delegates to `research` agent
4. **Given** orchestrator receives request, **When** user says "Compare React vs Vue for this project", **Then** orchestrator delegates to `research` agent

---

### User Story 2 - Planning Request Routing (Priority: P1)

As a user, when I ask the orchestrator to "plan" or "specify requirements" for a feature, I want it to delegate to `product-strategist` for business requirements or `strategic-architect` for technical architecture, even without triggering a full NEW_FEATURE workflow.

**Why this priority**: Planning agents should be accessible for standalone planning tasks, not just as part of multi-phase workflows.

**Independent Test**: Can be fully tested by sending "Plan the user authentication feature" and verifying it delegates to `product-strategist` directly.

**Acceptance Scenarios**:

1. **Given** orchestrator receives request, **When** user says "Plan the user authentication feature", **Then** orchestrator delegates to `product-strategist`
2. **Given** orchestrator receives request, **When** user says "Define requirements for the dashboard", **Then** orchestrator delegates to `product-strategist`
3. **Given** orchestrator receives request, **When** user says "Design the API architecture", **Then** orchestrator delegates to `strategic-architect`
4. **Given** orchestrator receives request, **When** user says "Create an ADR for database selection", **Then** orchestrator delegates to `strategic-architect`

---

### User Story 3 - Research-to-Planning Handoff (Priority: P2)

As a user, when research findings suggest a need for planning, I want the research agent to recommend delegation to planning agents so the workflow naturally progresses from discovery to specification.

**Why this priority**: This enables smooth transitions from research to planning without requiring user intervention to manually invoke planning agents.

**Independent Test**: Can be tested by completing a research task and verifying the research agent's output includes appropriate delegation recommendations.

**Acceptance Scenarios**:

1. **Given** research agent completes research on "authentication options", **When** findings suggest implementation decisions needed, **Then** research agent recommends delegation to `product-strategist`
2. **Given** research agent completes research on "database architecture patterns", **When** findings suggest architecture decisions needed, **Then** research agent recommends delegation to `strategic-architect`

---

### User Story 4 - Codebase Inquiry Distinction (Priority: P2)

As a user, when I ask to "explain" or "understand" existing code, I want it to route to `project-guru`, but when I ask to "research" or "investigate" external topics, I want it to route to `research` agent.

**Why this priority**: Clear distinction between internal codebase understanding (project-guru) and external knowledge gathering (research) prevents routing confusion.

**Independent Test**: Can be tested by sending both "Explain how our auth works" (→ project-guru) and "Research OAuth2 best practices" (→ research) and verifying different routing.

**Acceptance Scenarios**:

1. **Given** orchestrator receives request, **When** user says "Explain how our authentication works", **Then** orchestrator delegates to `project-guru`
2. **Given** orchestrator receives request, **When** user says "Research OAuth2 best practices", **Then** orchestrator delegates to `research`
3. **Given** orchestrator receives request, **When** user says "How does our API handle errors?", **Then** orchestrator delegates to `project-guru`
4. **Given** orchestrator receives request, **When** user says "Investigate error handling patterns in Express", **Then** orchestrator delegates to `research`

---

### Edge Cases

- **Ambiguous requests**: "Learn about authentication" - should clarify: internal codebase (project-guru) or external research (research)?
- **Mixed intent**: "Research and implement OAuth2" - should route to research first, then implementation
- **Planning with research**: "Plan authentication after researching options" - should route to research first, recommend planning handoff

## Requirements *(mandatory)*

### Functional Requirements

#### Intent Classification Changes

- **FR-001**: Orchestrator MUST add RESEARCH pattern to Intent Classification Decision Tree, positioned BEFORE CODEBASE_INQUIRY pattern
- **FR-002**: Orchestrator MUST add PLANNING pattern to Intent Classification Decision Tree for standalone planning requests
- **FR-003**: RESEARCH pattern MUST trigger on keywords: "research", "investigate", "explore", "discover", "compare", "evaluate", "analyze", "study", "find out", "learn about" (external context)
- **FR-004**: PLANNING pattern MUST trigger on keywords: "plan", "specify", "requirements", "PRD", "roadmap", "strategy", "scope", "define requirements"
- **FR-005**: PLANNING pattern MUST distinguish between product planning (→ product-strategist) and architecture planning (→ strategic-architect) based on sub-keywords

#### Keywords → Agent Mapping Updates

- **FR-006**: Keywords table MUST include entry for `research` agent with research-related keywords
- **FR-007**: Keywords table MUST include separate entries for `product-strategist` (business planning) and `strategic-architect` (technical planning)
- **FR-008**: Keywords table MUST clearly distinguish "research" (external) from "explain/understand" (internal codebase)

#### Workflow Pattern Addition

- **FR-009**: Orchestrator MUST define a RESEARCH workflow pattern with triggers, agents, and estimated time
- **FR-010**: RESEARCH workflow MUST support optional handoff to planning agents based on research findings
- **FR-011**: RESEARCH workflow estimated time MUST be 15 minutes to 4 hours (research is typically faster than implementation)

#### Few-Shot Examples

- **FR-012**: Orchestrator MUST include few-shot examples demonstrating correct research routing
- **FR-013**: Orchestrator MUST include few-shot examples demonstrating correct planning routing
- **FR-014**: Orchestrator MUST include few-shot examples showing research-to-planning handoff

#### Intent Priority Ordering

- **FR-015**: Orchestrator MUST document explicit intent priority ordering to prevent fall-through to incorrect patterns
- **FR-016**: RESEARCH pattern MUST be evaluated BEFORE CODEBASE_INQUIRY pattern in decision tree
- **FR-017**: PLANNING pattern MUST be evaluated BEFORE NEW_FEATURE pattern for standalone planning requests

### Key Entities

- **Intent Pattern**: A classification rule with keywords, task type, complexity, and target agent(s)
- **Workflow Pattern**: A defined sequence of agents for a specific task type with triggers and estimated time
- **Keyword Mapping**: Association between trigger keywords and target agents/workflows

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests containing "research" or "investigate" (without implementation keywords) route to `research` agent
- **SC-002**: 100% of requests containing "plan" or "requirements" (without implementation keywords) route to `product-strategist` or `strategic-architect`
- **SC-003**: 0% of research requests incorrectly route to `project-guru` (CODEBASE_INQUIRY)
- **SC-004**: Research agent appears in Keywords → Agent Mapping table with at least 5 trigger keywords
- **SC-005**: At least 3 few-shot examples demonstrate correct research/planning routing
- **SC-006**: RESEARCH workflow pattern is documented with triggers, agents, and estimated time

## Proposed Changes Summary

### 1. Add to Intent Classification Decision Tree (before CODEBASE_INQUIRY)

```
ELSE IF keywords match ["research", "investigate", "explore", "discover", "compare", "evaluate", "analyze", "study", "find out"]:
  → Task Type: RESEARCH
  → Complexity: SIMPLE to MEDIUM (15 min - 4 hours)
  → Agent: research
  → Output: Structured research report
  → NOTE: Research agent may delegate to product-strategist or strategic-architect for planning outputs

ELSE IF keywords match ["plan", "specify", "requirements", "PRD", "roadmap", "strategy", "scope", "define requirements"]:
  IF keywords match ["architecture", "system design", "ADR", "technical", "API design"]:
    → Task Type: ARCHITECTURE_PLANNING
    → Agent: strategic-architect
  ELSE:
    → Task Type: PRODUCT_PLANNING
    → Agent: product-strategist
  → NOTE: Planning agents produce spec.md or plan.md artifacts
```

### 2. Add to Keywords → Agent Mapping Table

| Keywords | Agent | Workflow |
|----------|-------|----------|
| research, investigate, explore, discover, compare, evaluate | research | Research |
| plan, requirements, PRD, scope, roadmap, strategy, user stories | product-strategist | Planning |
| architecture, system design, ADR, technical design, API design | strategic-architect | Planning |

### 3. Add RESEARCH Workflow Pattern

```
### Pattern: RESEARCH

**Triggers**: research, investigate, explore, discover, compare, evaluate, analyze, study

**Workflow**: Research workflow

**Agents**: research → (optional) product-strategist OR strategic-architect

**Estimated Time**: 15 min - 4 hours

**Plan Structure**:
Step 1: Research (15 min - 2 hours)
- research: Use DeepWiki, Context7, webfetch for comprehensive research

Step 2: Synthesize (optional, 30-60 min)
- product-strategist: If research leads to requirements
- strategic-architect: If research leads to architecture decisions
```

### 4. Add Few-Shot Examples

```
Example: Research routing
User: "Research best practices for authentication"
→ research → (findings may trigger) product-strategist or strategic-architect

Example: Planning routing
User: "Plan the user authentication feature"
→ product-strategist → strategic-architect → linear-coordinator

Example: Codebase inquiry (unchanged)
User: "Explain how our authentication works"
→ project-guru
```

### 5. Add Intent Priority Ordering

```
### Intent Priority Order (Process in this order)

1. **RESEARCH** - If user explicitly asks to research/investigate/explore (external knowledge)
2. **PLANNING** - If user asks to plan/design/specify (before implementation)
3. **NEW_FEATURE** - If user wants to build something new
4. **BUG_FIX** - If user reports an issue
5. **CODEBASE_INQUIRY** - If user wants to understand existing code (internal knowledge)
6. ... (other patterns)

**Key Distinction**:
- "Research X" → research agent (external knowledge gathering)
- "Explain X" → project-guru (internal codebase understanding)
- "Plan X" → product-strategist (requirements) or strategic-architect (architecture)
```

## Files to Modify

| File | Changes |
|------|---------|
| `.opencode/agent/orchestrator.md` | Add RESEARCH pattern, PLANNING pattern, update Keywords table, add workflow pattern, add few-shot examples, add priority ordering |

## Assumptions

- The `research` agent already exists and is functional (`.opencode/agent/research.md`)
- The `product-strategist` and `strategic-architect` agents already exist and are functional
- No changes needed to the individual agent files, only to orchestrator routing logic
- The orchestrator's decision tree is processed sequentially (order matters)

## Out of Scope

- Changes to individual agent capabilities (research, product-strategist, strategic-architect)
- New agent creation
- Changes to governance agents (context-steward, historian)
- UI/UX changes
- Testing framework changes
