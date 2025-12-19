# Feature Specification: Hive Mind Manager Architecture

**Feature ID**: `LIF-66-feat-hive-mind-architecture`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear**: [LIF-66](https://linear.app/lifelogger/issue/LIF-66)  
**Input**: Evolve OmO to multi-layer "hive mind" architecture with domain managers

## Problem Statement

**Current OmO is a "god object":**
- Prompt size: 1,134 lines (70% of practical context limit)
- Directly manages 20+ specialists
- Growth: +45-60 lines per new specialist (unsustainable)
- With 10 more agents: ~1,700 lines (exceeds limits)

**Solution**: Add manager layer between OmO and specialists to distribute context and enable domain-specific orchestration.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OmO (Meta-Orchestrator)                      │
│                    High-level routing + Cross-domain                 │
│                    Target: 700-800 lines (30-40% reduction)         │
└───────────┬─────────────┬─────────────┬─────────────┬───────────────┘
            │             │             │             │
   ┌────────▼────────┐ ┌──▼──────────┐ ┌▼────────────┐ ┌▼────────────┐
   │ implementation- │ │  quality-   │ │   docs-     │ │    ai-      │
   │   specialist    │ │   manager   │ │   manager   │ │   manager   │
   │   (EXISTS)      │ │   (NEW)     │ │   (NEW)     │ │  (FUTURE)   │
   └────────┬────────┘ └──────┬──────┘ └──────┬──────┘ └─────────────┘
            │                 │               │
   ┌────────▼────────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ Backend/Frontend│ │ code-review │ │ doc-writer  │
   │ Mobile specs    │ │ test-spec   │ │ docs-pub    │
   │ (13 agents)     │ │ security    │ │ (future)    │
   └─────────────────┘ └─────────────┘ └─────────────┘
```

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quality Manager Coordination (Priority: P1)

Plugin users want quality concerns (code review, testing, security) handled by a dedicated manager that owns the "ship/no-ship" decision and coordinates quality pipelines without burdening OmO.

**Why this priority**: Highest ROI per Oracle analysis. Quality gates are cross-cutting and currently fragment OmO's context.

**Independent Test**: Invoke quality-manager with "review and test this PR" and verify it coordinates code-reviewer → test-specialist → security-specialist in proper sequence.

**Acceptance Scenarios**:

1. **Given** code changes ready for review, **When** OmO delegates to quality-manager, **Then** quality-manager coordinates review → test → security pipeline
2. **Given** quality-manager detects security issue, **When** evaluating ship readiness, **Then** it blocks with clear explanation (not deferred to OmO)
3. **Given** all quality checks pass, **When** quality-manager completes, **Then** it returns compressed summary (5-10 lines) to OmO

---

### User Story 2 - Docs Manager Pipeline (Priority: P2)

Plugin users want documentation workflows (content → structure → publish) handled by a dedicated manager that routes to appropriate doc specialists and owns doc quality standards.

**Why this priority**: High ROI when docs pipeline is real workload. Clean separation of content creation vs site operations.

**Independent Test**: Invoke docs-manager with "create and publish API docs" and verify it routes content to document-writer, then structure/publish to docs-publisher.

**Acceptance Scenarios**:

1. **Given** request to "write API documentation", **When** docs-manager receives task, **Then** it delegates to document-writer (content creation)
2. **Given** request to "publish docs site", **When** docs-manager receives task, **Then** it delegates to docs-publisher (site operations)
3. **Given** complex request "create and publish feature docs", **When** docs-manager receives task, **Then** it sequences: document-writer → docs-publisher

---

### User Story 3 - OmO Context Reduction (Priority: P2)

System architects want OmO's prompt reduced by 30-40% by moving domain-specific routing logic to managers, keeping OmO focused on high-level orchestration.

**Why this priority**: Enables scalability to 50+ specialists without context overflow.

**Independent Test**: Measure OmO prompt size before/after manager extraction and verify 30-40% reduction.

**Acceptance Scenarios**:

1. **Given** current OmO at 1,134 lines, **When** managers handle domain routing, **Then** OmO reduces to 700-800 lines
2. **Given** new specialist added, **When** it belongs to existing manager domain, **Then** OmO prompt unchanged (manager handles routing)
3. **Given** 50 specialists in system, **When** organized under 5 managers, **Then** OmO context remains within practical limits

---

### User Story 4 - OmO Domain Profiles (Priority: P3)

System architects want domain-specific OmO behavior (Software, Finance, Data, DevOps) via profiles/configs rather than separate agents.

**Why this priority**: Enables domain specialization without duplicating orchestration logic.

**Independent Test**: Configure project as "finance" type and verify OmO loads finance-specific policies.

**Acceptance Scenarios**:

1. **Given** project-context.yaml specifies `type: fintech`, **When** OmO initializes, **Then** it loads finance profile (risk signoff required, compliance checks)
2. **Given** user says "use devops mode", **When** OmO processes request, **Then** it applies infrastructure safety policies
3. **Given** no profile specified, **When** OmO initializes, **Then** it defaults to Software profile

---

### User Story 5 - AI Manager Coordination (Priority: P4)

Plugin users want AI/ML work (RAG systems, agent design, model integration) handled by a dedicated manager when AI workload justifies it.

**Why this priority**: Future need - add only when AI tasks disrupt software delivery.

**Independent Test**: Invoke ai-manager with "design RAG pipeline" and verify it coordinates ai-ml-expert and agent-specialist appropriately.

**Acceptance Scenarios**:

1. **Given** request for RAG system design, **When** ai-manager receives task, **Then** it delegates to ai-ml-expert
2. **Given** request for multi-agent orchestration, **When** ai-manager receives task, **Then** it delegates to agent-specialist

---

### Edge Cases

- What if manager and OmO give conflicting decisions? Manager authority wins within domain; OmO can override only with explicit escalation.
- What if specialist is needed by multiple managers? Specialists are shared; managers coordinate via OmO if conflict.
- What if manager fails mid-pipeline? Return partial results to OmO with clear failure context for recovery.

## Requirements *(mandatory)*

### Functional Requirements

**Manager Infrastructure:**
- **FR-001**: System MUST support "manager" agent role with delegation capability (`task: true`, `background_task: true`)
- **FR-002**: Managers MUST NOT call upward (`call_omo_agent: false`) to prevent loops
- **FR-003**: Managers MUST use 7-section delegation protocol for all specialist calls
- **FR-004**: Managers MUST return compressed summaries (5-10 lines) to OmO, not full transcripts

**quality-manager:**
- **FR-005**: quality-manager MUST coordinate code-reviewer, test-specialist, security-specialist, optimization-specialist
- **FR-006**: quality-manager MUST own "ship/no-ship" decision based on quality gates
- **FR-007**: quality-manager MUST handle iterative review loops (review → fix → re-review) without OmO involvement

**docs-manager:**
- **FR-008**: docs-manager MUST route content creation to document-writer
- **FR-009**: docs-manager MUST route site operations to docs-publisher
- **FR-010**: docs-manager MUST own doc quality standards and validation

**OmO Evolution:**
- **FR-011**: OmO MUST delegate quality concerns to quality-manager
- **FR-012**: OmO MUST delegate doc concerns to docs-manager
- **FR-013**: OmO prompt MUST reduce by 30-40% after manager extraction
- **FR-014**: OmO MUST support profile-based behavior (Software, Finance, Data, DevOps)

### Key Entities

- **AgentRole**: Extended with explicit "manager" capabilities (delegation without upward calls)
- **ManagerConfig**: Manager-specific configuration (specialists owned, quality gates, domain policies)
- **OmOProfile**: Domain-specific config fragment (policies, routing preferences, stop conditions)
- **DelegationProtocol**: 7-section prompt format standardized across all managers

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: OmO prompt size reduces from 1,134 lines to 700-800 lines (30-40% reduction)
- **SC-002**: Adding new specialist to existing domain requires 0 changes to OmO prompt
- **SC-003**: quality-manager handles review→test→security pipeline end-to-end without OmO involvement
- **SC-004**: docs-manager correctly routes 100% of doc requests to appropriate specialist
- **SC-005**: System scales to 50+ specialists while OmO context remains under 1,000 lines
- **SC-006**: Manager responses to OmO are ≤10 lines (compressed summaries)

## Implementation Priority (from Oracle)

| Phase | Component | ROI | Effort | Dependency |
|-------|-----------|-----|--------|------------|
| 1 | docs-publisher | Foundation | 30 min | None |
| 2 | quality-manager | VERY HIGH | 2-4h | None |
| 3 | docs-manager | HIGH | 1-2h | docs-publisher |
| 4 | OmO profile system | HIGH | 4-8h | None |
| 5 | ai-manager | MEDIUM | 2-4h | When needed |

## Research Summary

**Analysis completed:**
- 5 explore agents analyzed patterns, hierarchy, complexity
- Oracle consultation provided architectural guidance
- implementation-specialist pattern extracted as manager template

**Key findings:**
- "Add managers only when they reduce OmO context + decision load" (Oracle)
- quality-manager highest ROI (cross-cutting gates)
- Specialists MUST remain terminal (cannot delegate)
- Maximum 2 hops: OmO → Manager → Specialist
- Profiles preferred over separate OmO agents for domain variants

## Dependencies

- **Requires first**: docs-publisher agent (LIF-66 depends on 004-feat-docs-publisher)
- **Template**: implementation-specialist.ts manager pattern
- **Infrastructure**: Manager role support in AGENT_ROLE_REGISTRY

## Handoff

Ready for `/plan` phase after 004-feat-docs-publisher is complete. Strategic Architect should:
1. Design quality-manager agent (highest priority)
2. Design docs-manager agent
3. Design OmO profile system
4. Extract manager template from implementation-specialist
