# Feature Specification: Multi-Layered Agent Orchestration Enhancement

**Feature ID**: `LIF-62-feat-multi-layered-orchestration`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear Issue**: [LIF-62](https://linear.app/lifelogger/issue/LIF-62/multi-layered-agent-orchestration-enhancement-for-oh-my-opencode)  
**Branch**: `hello/lif-62-multi-layered-agent-orchestration-enhancement-for-oh-my`

## Executive Summary

Enhance the Oh My OpenCode (OMO) plugin with multi-layered agent orchestration, centralized governance injection, and improved workflow integration. This enhancement addresses the governance gap where only OmO has awareness of governance tools and workflows, while the other 6 agents operate without governance context.

### Current State Analysis

| Agent | Model | Role | Modifies Files? | Governance Aware? |
|-------|-------|------|-----------------|-------------------|
| **OmO** | claude-opus-4-5 | Primary orchestrator | Yes (delegates) | ✅ Full |
| **oracle** | gpt-5.2 | Strategic advisor | No | ❌ None |
| **librarian** | claude-sonnet-4-5 | External research | No | ❌ None |
| **explore** | grok-code | Codebase exploration | No | ❌ None |
| **frontend-ui-ux-engineer** | gemini-3-pro | UI/UX implementation | **Yes** | ❌ None |
| **document-writer** | gemini-3-pro | Documentation | **Yes** | ❌ None |
| **multimodal-looker** | gemini-2.5-flash | Media analysis | No | ❌ None |

**Key Finding**: 2 of 7 agents modify files without governance awareness.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Governance-Aware Frontend Implementation (Priority: P1)

As a developer using OMO, when I delegate UI work to the frontend-ui-ux-engineer agent, I want the agent to automatically follow governance rules (path validation, changelog tracking, Linear integration) so that my frontend changes are properly tracked and organized.

**Why this priority**: Frontend work is the most common delegation from OmO, and currently bypasses all governance. This creates audit gaps and inconsistent project organization.

**Independent Test**: Can be fully tested by delegating a UI task to frontend-ui-ux-engineer and verifying that:
1. Path validation warnings/blocks appear for non-standard paths
2. Changelog entries are created for file modifications
3. Linear context is injected when issue IDs are mentioned

**Acceptance Scenarios**:

1. **Given** a user requests "create a login form component", **When** frontend-ui-ux-engineer creates files, **Then** the governance-path-validator hook validates the file paths
2. **Given** frontend-ui-ux-engineer modifies 3 files, **When** the session ends, **Then** the governance-historian hook creates a changelog entry listing all 3 files
3. **Given** a user mentions "LIF-62" in their request, **When** frontend-ui-ux-engineer receives the task, **Then** Linear context (issue title, status, branch) is injected into the prompt

---

### User Story 2 - Multi-Layered Implementation Delegation (Priority: P1)

As a developer using OMO, when I request a complex implementation task, I want OmO to delegate to an Implementation Specialist agent that can further delegate to specialized sub-agents (Backend TypeScript, Frontend React) so that each domain expert handles their specialty.

**Why this priority**: Complex tasks often span multiple domains. Current flat delegation to frontend-ui-ux-engineer doesn't support backend work, and OmO's context window is consumed by implementation details.

**Independent Test**: Can be fully tested by requesting "implement a user authentication feature with login form and API endpoint" and verifying that:
1. OmO delegates to Implementation Specialist
2. Implementation Specialist delegates frontend to Frontend React sub-agent
3. Implementation Specialist delegates backend to Backend TypeScript sub-agent
4. Results are aggregated and returned to OmO

**Acceptance Scenarios**:

1. **Given** a user requests a full-stack feature, **When** OmO analyzes the task, **Then** OmO delegates to Implementation Specialist (not directly to frontend-ui-ux-engineer)
2. **Given** Implementation Specialist receives a full-stack task, **When** it identifies frontend and backend components, **Then** it delegates to appropriate specialized sub-agents
3. **Given** sub-agents complete their work, **When** Implementation Specialist aggregates results, **Then** it returns a structured summary to OmO with file lists and status

---

### User Story 3 - Centralized Governance Template Injection (Priority: P2)

As a plugin maintainer, I want governance rules to be defined once in a centralized template and automatically injected into relevant agents so that I don't have to duplicate governance instructions across multiple agent prompts.

**Why this priority**: Currently, adding governance to an agent requires copying ~200 lines of governance instructions. A centralized template reduces maintenance burden and ensures consistency.

**Independent Test**: Can be fully tested by modifying the governance template and verifying that all governance-aware agents receive the updated instructions without individual agent file changes.

**Acceptance Scenarios**:

1. **Given** a governance template exists with Linear integration instructions, **When** frontend-ui-ux-engineer is invoked, **Then** the Linear instructions are injected into its prompt
2. **Given** the governance template is updated to add a new rule, **When** any governance-aware agent is invoked, **Then** the new rule is present in the agent's prompt
3. **Given** a read-only agent (explore) is invoked, **When** the system checks governance requirements, **Then** the governance template is NOT injected (read-only agents excluded)

---

### User Story 4 - Structured Response Formats for Tool Outputs (Priority: P2)

As a developer using OMO, I want agents to return structured responses for tool outputs (JSON schemas) while maintaining flexibility for explanations (markdown) so that data flows predictably between agents without limiting creative problem-solving.

**Why this priority**: Unstructured responses make it difficult to parse agent outputs programmatically. Structured formats enable better context management and handoff between agents.

**Independent Test**: Can be fully tested by invoking a tool that returns structured output and verifying the JSON schema is valid, while explanatory text remains free-form markdown.

**Acceptance Scenarios**:

1. **Given** Implementation Specialist completes a task, **When** it returns results to OmO, **Then** the response includes a JSON block with `{files_created: [], files_modified: [], status: "success|partial|failed"}`
2. **Given** a sub-agent completes work, **When** it returns to Implementation Specialist, **Then** the handoff includes structured metadata AND free-form explanation
3. **Given** an agent needs to explain a complex decision, **When** it generates output, **Then** the explanation is in markdown format (not constrained to JSON)

---

### User Story 5 - Document Writer Governance Integration (Priority: P3)

As a developer using OMO, when I delegate documentation tasks to document-writer, I want the agent to follow governance rules so that documentation changes are tracked and organized consistently.

**Why this priority**: Documentation is less frequent than frontend work but still modifies files. Governance ensures docs are tracked in changelogs and follow path conventions.

**Independent Test**: Can be fully tested by delegating a documentation task and verifying governance hooks fire for document-writer's file operations.

**Acceptance Scenarios**:

1. **Given** document-writer creates a README file, **When** the file is written, **Then** governance-path-validator validates the path
2. **Given** document-writer modifies documentation files, **When** the session ends, **Then** changelog entries are created

---

### User Story 6 - Complete Workflow Visualization (Priority: P3)

As a plugin maintainer, I want a documented workflow map showing how tasks flow from user request through OmO, Implementation Specialist, sub-agents, and governance hooks so that I can understand and debug the orchestration system.

**Why this priority**: Complex multi-layered orchestration is difficult to debug without a clear workflow map. Documentation enables maintenance and onboarding.

**Independent Test**: Can be fully tested by reviewing the workflow documentation and tracing a sample task through all documented stages.

**Acceptance Scenarios**:

1. **Given** a workflow map exists, **When** a developer traces a task, **Then** they can identify which agent handles each stage
2. **Given** governance hooks are documented, **When** a developer reviews the workflow, **Then** they can identify where path validation, historian tracking, and Linear injection occur

---

### Edge Cases

- **What happens when** a sub-agent fails mid-task? Implementation Specialist should capture partial results and report failure to OmO with context.
- **What happens when** governance-path-validator blocks a write? The agent should receive a clear error message with suggested correct path.
- **What happens when** Linear MCP is unavailable? Governance-linear-injector should gracefully degrade without breaking the workflow.
- **What happens when** a task spans both frontend and backend but user only wants frontend? Implementation Specialist should respect scope constraints.
- **How does the system handle** nested delegation (OmO → Impl Specialist → Sub-agent → further delegation)? Limit delegation depth to 2 levels to prevent context explosion.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Governance Injection

- **FR-001**: System MUST inject governance instructions into frontend-ui-ux-engineer agent prompts
- **FR-002**: System MUST inject governance instructions into document-writer agent prompts
- **FR-003**: System MUST NOT inject governance instructions into read-only agents (oracle, librarian, explore, multimodal-looker)
- **FR-004**: Governance injection MUST be centralized in a single template file or configuration
- **FR-005**: Governance template MUST include: path validation awareness, changelog discipline, Linear integration, spec-driven workflow awareness

#### Multi-Layered Orchestration

- **FR-006**: System MUST provide an Implementation Specialist agent that acts as a delegation hub
- **FR-007**: Implementation Specialist MUST be able to delegate to Backend TypeScript sub-agent
- **FR-008**: Implementation Specialist MUST be able to delegate to Frontend React sub-agent
- **FR-009**: Sub-agents MUST return structured results to Implementation Specialist
- **FR-010**: Implementation Specialist MUST aggregate sub-agent results before returning to OmO
- **FR-011**: Delegation depth MUST be limited to 2 levels (OmO → Impl Specialist → Sub-agent)

#### Structured Response Formats

- **FR-012**: Tool outputs MUST follow defined JSON schemas for structured data
- **FR-013**: Agent explanations MUST remain in free-form markdown (not constrained to JSON)
- **FR-014**: Handoff between agents MUST include structured metadata block
- **FR-015**: Structured response schemas MUST be documented and versioned

#### Workflow Integration

- **FR-016**: System MUST document the complete workflow from task initiation to completion
- **FR-017**: Governance hooks MUST fire for all file-modifying agents (not just OmO)
- **FR-018**: Changelog entries MUST be created for all agent sessions that modify files
- **FR-019**: Linear context MUST be injected when issue IDs are detected in any agent's input

### Non-Functional Requirements

- **NFR-001**: Governance injection MUST NOT increase agent prompt size by more than 500 tokens
- **NFR-002**: Multi-layered delegation MUST NOT increase total task completion time by more than 20%
- **NFR-003**: All changes MUST be backward compatible (no breaking changes to existing OMO functionality)
- **NFR-004**: New agents MUST follow existing OMO agent patterns and conventions

### Key Entities

- **Governance Template**: Centralized configuration defining governance rules to inject into agents. Contains: path validation rules, changelog requirements, Linear integration patterns, spec workflow awareness.
- **Implementation Specialist**: New agent that acts as delegation hub between OmO and specialized sub-agents. Analyzes tasks, delegates to appropriate specialists, aggregates results.
- **Backend TypeScript Sub-Agent**: Specialized agent for TypeScript/Node.js backend implementation. Receives delegated tasks from Implementation Specialist.
- **Frontend React Sub-Agent**: Specialized agent for React frontend implementation. Receives delegated tasks from Implementation Specialist.
- **Structured Response Schema**: JSON schema defining required fields for agent handoffs: `{files_created, files_modified, status, summary, errors}`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of file-modifying agents (frontend-ui-ux-engineer, document-writer) have governance awareness after implementation
- **SC-002**: Governance template changes propagate to all governed agents without individual agent file modifications
- **SC-003**: Multi-layered delegation (OmO → Impl Specialist → Sub-agent) completes successfully for full-stack tasks
- **SC-004**: Structured response schemas are validated for 100% of agent handoffs
- **SC-005**: No breaking changes to existing OMO functionality (all existing tests pass)
- **SC-006**: Workflow documentation covers 100% of task flow stages from initiation to completion
- **SC-007**: Changelog entries are created for all sessions where file-modifying agents make changes

---

## Assumptions

1. **OpenCode Plugin API**: Assumes the OpenCode plugin API supports prompt injection/extension mechanisms for agents
2. **Agent Tool Access**: Assumes sub-agents can be restricted from certain tools (e.g., no `task` tool for sub-agents to prevent infinite delegation)
3. **Hook Execution Order**: Assumes governance hooks execute in the correct order (path-validator before write, historian after write)
4. **Linear MCP Availability**: Assumes Linear MCP is available for most users; graceful degradation for offline scenarios
5. **Context Window Limits**: Assumes governance injection (~500 tokens) fits within agent context windows without significant impact

---

## Out of Scope

- Governance for read-only agents (oracle, librarian, explore, multimodal-looker)
- Full JSON response schemas for all agent outputs (too restrictive for creative problem-solving)
- Additional specialized sub-agents beyond Backend TypeScript and Frontend React (future enhancement)
- Automated testing framework for multi-agent orchestration (separate initiative)
- UI for visualizing agent orchestration flow (separate initiative)

---

## Related Issues

- [LIF-57](https://linear.app/lifelogger/issue/LIF-57): Enhance oh-my-opencode with governance patterns (DONE) - Foundation for this work
- [LIF-58](https://linear.app/lifelogger/issue/LIF-58): Add Spec-to-Todo Workflow to OmO (DONE) - OmO already has spec awareness
- [LIF-59](https://linear.app/lifelogger/issue/LIF-59): Add Intent Classification to OmO (DONE) - OmO already classifies task types
- [LIF-60](https://linear.app/lifelogger/issue/LIF-60): Restructure orchestrator and agent instructions (IN PROGRESS) - Related restructuring work

---

## Technical Context

### Current Architecture

```
src/agents/
├── index.ts          # Agent registry (builtinAgents)
├── types.ts          # Type definitions
├── utils.ts          # Agent creation utilities
├── omo.ts            # OmO agent (1094 lines, full governance)
├── oracle.ts         # Oracle agent (78 lines, no governance)
├── librarian.ts      # Librarian agent (241 lines, no governance)
├── explore.ts        # Explore agent (258 lines, no governance)
├── frontend-ui-ux-engineer.ts  # Frontend agent (93 lines, no governance)
├── document-writer.ts          # Doc writer agent (204 lines, no governance)
├── multimodal-looker.ts        # Media agent (43 lines, no governance)
└── build.ts          # Build agent extension (134 lines)

src/hooks/
├── governance-path-validator/  # Path validation hook
├── governance-historian/       # Changelog tracking hook
└── governance-linear-injector/ # Linear context injection hook

src/tools/
├── linear/           # Linear tools (branch, status, create)
├── spec/             # Spec folder tool
└── project-context/  # Read context tool
```

### Proposed Architecture Changes

```
src/agents/
├── ... (existing agents)
├── implementation-specialist.ts  # NEW: Delegation hub agent
├── backend-typescript.ts         # NEW: Backend sub-agent
└── frontend-react.ts             # NEW: Frontend sub-agent

src/config/
├── schema.ts         # Add governance injection config
└── governance-template.ts  # NEW: Centralized governance template

src/hooks/
├── governance-prompt-injector/  # NEW: Inject governance into agent prompts
└── ... (existing hooks)
```

### Governance Template Structure (Proposed)

```typescript
const GOVERNANCE_TEMPLATE = `
<governance>
## Governance Awareness

You are operating within a governed environment. Follow these rules:

### Path Discipline
- Spec files → \`.cursor/specs/{ISSUE-ID}-{type}-{name}/\`
- Source code → \`src/\`, \`tests/\`, \`docs/\`
- Memory files → \`.cursor/memory/\`

### Changelog Discipline
- Your file modifications are tracked automatically
- Changelog entries are created at session end
- Include meaningful commit messages

### Linear Integration
- When you see issue IDs (e.g., LIF-123), Linear context is available
- Use \`linear_branch\` to get correct branch names
- Use \`linear_update_status\` when completing work

### Spec-Driven Workflow
- Check for existing spec folders before major work
- Use \`create_spec_folder\` for new features >4h
- Read \`tasks.md\` for task breakdowns
</governance>
`;
```

---

## Next Steps

1. **Product Strategist Review**: Validate user stories and priorities
2. **Strategic Architect**: Design detailed technical architecture
3. **Linear Coordinator**: Create sub-tasks for each phase
4. **Implementation**: Execute phases 1-4 as defined in Linear issue
