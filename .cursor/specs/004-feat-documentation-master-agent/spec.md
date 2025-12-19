# Feature Specification: Docs Publisher Agent

**Feature ID**: `004-feat-docs-publisher-agent`  
**Created**: 2025-12-18  
**Updated**: 2025-12-18 (renamed from documentation-master)  
**Status**: Draft  
**Input**: Import documentation-master agent, rename to docs-publisher for clarity

## Naming Rationale

**docs-publisher** chosen over documentation-master because:
- **Distinct from document-writer**: writer = creates content; publisher = structures, validates, publishes
- **Platform-agnostic**: Works if switching from Mintlify to Docusaurus/GitBook
- **Action-oriented**: Matches agent naming pattern (quick-fixer, code-reviewer)
- **Short**: Easy to type in delegation prompts

## Agent Routing Clarity

| Task | Agent | Focus |
|------|-------|-------|
| Write README, inline docs, markdown prose | document-writer | Content creation |
| Structure nav, validate docs, publish site | docs-publisher | Site operations |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Documentation Site Publishing (Priority: P1)

Plugin users want to structure, validate, and publish documentation sites using a specialized agent that handles doc site operations independently of content creation.

**Why this priority**: Core functionality - enables documentation site operations through OmO orchestration.

**Independent Test**: Invoke `task(subagent_type="docs-publisher")` with a docs publishing request and verify it produces properly structured, validated output.

**Acceptance Scenarios**:

1. **Given** user has docs in `docs/` folder, **When** they invoke `task(subagent_type="docs-publisher", prompt="Validate and structure navigation for docs site")`, **Then** agent validates structure, updates navigation config, and reports issues
2. **Given** docs-publisher receives a publishing request, **When** processing, **Then** it uses context7 MCP to validate code examples against official library documentation
3. **Given** docs need Mintlify formatting, **When** docs-publisher processes them, **Then** output includes proper frontmatter, components (CodeGroup, Note, Warning), and navigation structure

---

### User Story 2 - Parallel Specialist Integration (Priority: P1)

docs-publisher must integrate as a specialist agent parallel to document-writer, with OmO/manager routing between them based on task type.

**Why this priority**: Clean separation ensures correct agent selection.

**Independent Test**: Verify both agents exist in DELEGATABLE_AGENTS with distinct purposes.

**Acceptance Scenarios**:

1. **Given** docs-publisher is registered, **When** checking AGENT_ROLE_REGISTRY, **Then** it has role "specialist"
2. **Given** docs-publisher is a specialist, **When** checking tools config, **Then** background_task is disabled (cannot delegate)
3. **Given** OmO receives "publish docs site" request, **When** routing, **Then** it selects docs-publisher (not document-writer)
4. **Given** OmO receives "write README" request, **When** routing, **Then** it selects document-writer (not docs-publisher)

---

### User Story 3 - Governance Compliance (Priority: P2)

docs-publisher must follow governance patterns including path validation, changelog creation, and Linear integration.

**Why this priority**: Consistency with project governance standards.

**Acceptance Scenarios**:

1. **Given** docs-publisher modifies files, **When** governance hooks active, **Then** path validation enforced
2. **Given** docs-publisher completes work, **When** historian hook runs, **Then** changelog entry created
3. **Given** Linear MCP available, **When** docs-publisher needs to update issues, **Then** it can use linear_create_comment

---

### Edge Cases

- **Context7 unavailable**: Agent should still process docs but note code examples weren't verified
- **Missing docs folder**: Agent should create necessary directory structure
- **Platform switch**: If Mintlify → Docusaurus, agent adapts (platform-agnostic design)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create `src/agents/docs-publisher.ts` with AgentConfig export
- **FR-002**: System MUST add "docs-publisher" to BuiltinAgentName union in `types.ts`
- **FR-003**: System MUST register agent in `builtinAgents` map in `index.ts`
- **FR-004**: System MUST assign "specialist" role in `AGENT_ROLE_REGISTRY`
- **FR-005**: System MUST add "docs-publisher" to `DELEGATABLE_AGENTS` array
- **FR-006**: Agent MUST use model `google/gemini-3-pro-preview`
- **FR-007**: Agent MUST have `background_task: false` (specialist cannot delegate)
- **FR-008**: Agent prompt MUST include site structure validation workflow
- **FR-009**: Agent prompt MUST include navigation configuration (mint.json or equivalent)
- **FR-010**: Agent prompt MUST include context7 MCP for code example validation
- **FR-011**: Agent prompt MUST include governance workflow (historian, Linear Tier 2)

### Key Entities

- **docsPublisherAgent**: AgentConfig exported from `src/agents/docs-publisher.ts`
- **BuiltinAgentName**: Union type extended with "docs-publisher"
- **AGENT_ROLE_REGISTRY**: Maps "docs-publisher" → "specialist"
- **DELEGATABLE_AGENTS**: Includes "docs-publisher"

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agent invocable via `task(subagent_type="docs-publisher")` without errors
- **SC-002**: `bun run typecheck` succeeds with zero type errors
- **SC-003**: Agent validates and structures docs with proper frontmatter/navigation
- **SC-004**: Agent appears in `call_omo_agent` subagent_type enum
- **SC-005**: Agent respects specialist restrictions (no background_task)
- **SC-006**: Clear routing: OmO selects docs-publisher for site ops, document-writer for content

## Technical Context

### Source Agent

Converting `.opencode/agent/documentation-master.md` with rename:
- **New name**: docs-publisher (was documentation-master)
- **Model**: `google/gemini-3-pro-preview`
- **Mode**: subagent
- **Tools**: `{ background_task: false }`
- **Linear access**: Tier 2 (READ + COMMENT)

### Prompt Structure

```xml
<role>Documentation site specialist - structure, validate, publish</role>
<scope>
  IN: Nav structure, validation, frontmatter, site publishing
  OUT: Content writing (that's document-writer's job)
</scope>
<workflow>Pre-flight → Validate → Structure → Publish → Historian</workflow>
<integrations>Context7, Linear (Tier 2), mintlify-sync tool</integrations>
<platforms>Mintlify (primary), extensible to Docusaurus/GitBook</platforms>
```

### Architecture

```
OmO (Team Lead)
├── document-writer (specialist) ─ Content creation
│   └── README, API docs, markdown prose
└── docs-publisher (specialist) ─ Site operations
    └── Structure, validate, navigation, publish
```

### Files to Create/Modify

1. `src/agents/docs-publisher.ts` - NEW: Agent definition
2. `src/agents/types.ts` - ADD: "docs-publisher" to types
3. `src/agents/index.ts` - ADD: Import, register, role assignment

## Handoff

Ready for `/plan` phase with updated architecture:
1. Create docs-publisher agent (site operations focus)
2. Keep document-writer unchanged (content creation focus)
3. Update OmO routing logic for clear agent selection
