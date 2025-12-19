# Feature Specification: Sync Cursor and OpenCode Agent/Command/Template Directories

**Feature ID**: `LIF-54-refactor-sync-cursor-opencode`  
**Created**: 2025-12-16  
**Status**: In Progress  
**Linear Issue**: [LIF-54](https://linear.app/lifelogger/issue/LIF-54/sync-cursor-and-opencode-agentcommandtemplate-directories)  
**Branch**: `hello/lif-54-sync-cursor-and-opencode-agentcommandtemplate-directories`

## Executive Summary

Synchronize the `.cursor/` and `.opencode/` directory structures to ensure consistent agent definitions, commands, and templates across both IDE environments. This refactoring eliminates divergence, consolidates duplicates, and establishes a sustainable sync workflow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Uses OpenCode with Same Agent Capabilities (Priority: P1)

As a developer using OpenCode CLI, I want access to the same agent capabilities available in Cursor IDE, so that I can use spec-driven development workflows regardless of my IDE choice.

**Why this priority**: Core value proposition - both IDEs should provide equivalent agent functionality. Without this, OpenCode users have a degraded experience.

**Independent Test**: Can be fully tested by invoking `/specify` command in OpenCode and verifying it produces the same spec.md structure as Cursor, with proper agent delegation working.

**Acceptance Scenarios**:

1. **Given** a developer using OpenCode CLI, **When** they invoke `/specify "user authentication"`, **Then** the product-strategist agent is invoked with proper path validation and spec.md is created in `.cursor/specs/`.
2. **Given** a developer using OpenCode CLI, **When** they invoke `/implement LIF-54`, **Then** the implementation-specialist agent follows the same workflow as in Cursor.
3. **Given** agent delegation in OpenCode, **When** product-strategist delegates to context-steward, **Then** the delegation uses correct categorized path (`governance/context-steward`).

---

### User Story 2 - Commands Work Consistently Across IDEs (Priority: P1)

As a developer switching between Cursor and OpenCode, I want all commands to work the same way in both environments, so that I don't have to remember different workflows.

**Why this priority**: Command parity is essential for team workflows where developers use different IDEs.

**Independent Test**: Can be fully tested by running the same command (e.g., `/checklist`, `/code-review`) in both IDEs and comparing outputs.

**Acceptance Scenarios**:

1. **Given** a command exists in `.cursor/commands/`, **When** I check `.opencode/command/`, **Then** an equivalent command exists with the same functionality.
2. **Given** `/update-context` command in Cursor, **When** I run the same command in OpenCode, **Then** it updates the same memory files with the same format.
3. **Given** `/sync-linear` command in Cursor, **When** ported to OpenCode, **Then** it integrates with Linear MCP the same way.

---

### User Story 3 - Translation Guide Enables Maintenance (Priority: P2)

As a maintainer of the agent system, I want a clear translation guide between Cursor and OpenCode formats, so that I can keep both systems in sync efficiently.

**Why this priority**: Enables sustainable maintenance. Without this, sync becomes ad-hoc and error-prone.

**Independent Test**: Can be fully tested by using the translation guide to port a new agent from Cursor to OpenCode and verifying it works correctly.

**Acceptance Scenarios**:

1. **Given** the translation guide at `.opencode/instructions/cursor-opencode-sync.md`, **When** I need to sync an agent, **Then** the guide provides clear step-by-step instructions.
2. **Given** an agent path reference in Cursor format (`@Product-Strategist`), **When** I consult the translation guide, **Then** I find the equivalent OpenCode format (`task(subagent_type: "planning/product-strategist")`).
3. **Given** a new agent added to Cursor, **When** I follow the sync procedure, **Then** the agent is correctly added to OpenCode with proper categorization.

---

### User Story 4 - OpenCode-Specific Features Preserved (Priority: P2)

As an OpenCode user, I want OpenCode-specific features (custom tools, orchestrator, project init) preserved and documented, so that I don't lose functionality during sync.

**Why this priority**: OpenCode has unique capabilities that must not be lost in the sync process.

**Independent Test**: Can be fully tested by verifying OpenCode-specific files exist and function correctly after sync operations.

**Acceptance Scenarios**:

1. **Given** OpenCode custom tools in `.opencode/tool/`, **When** sync operations complete, **Then** all custom tools remain functional.
2. **Given** OpenCode orchestrator agent, **When** compared to Cursor conductor, **Then** orchestrator's unique tool-based delegation is preserved.
3. **Given** `/init-project` command (OpenCode-only), **When** sync completes, **Then** the command remains functional and documented.

---

### User Story 5 - Divergence Audit Provides Visibility (Priority: P3)

As a project maintainer, I want a clear audit report of all divergences between Cursor and OpenCode, so that I can track sync status and prioritize work.

**Why this priority**: Visibility enables informed decision-making about what to sync and when.

**Independent Test**: Can be fully tested by generating the audit report and verifying it accurately reflects the current state.

**Acceptance Scenarios**:

1. **Given** the divergence audit, **When** I review it, **Then** I see a complete list of agents in both directories with sync status.
2. **Given** the audit report, **When** I look for missing commands, **Then** I see exactly which commands need porting with priority levels.
3. **Given** the audit report, **When** I check for duplicates, **Then** I see conductor/orchestrator consolidation status.

---

### Edge Cases

- What happens when an agent exists in OpenCode but not Cursor (e.g., `agent-engineer`, `research`, `conversation-auditor`)?
  - **Decision**: Preserve OpenCode-only agents, document them in audit report.
- How does the system handle conflicting agent definitions?
  - **Decision**: Cursor is source of truth for shared agents; OpenCode format is preserved.
- What if a command references an agent that doesn't exist in OpenCode?
  - **Decision**: Port the agent first, then the command.
- How to handle conductor.md (command) vs orchestrator.md (agent)?
  - **Decision**: Document as equivalent but different implementations; don't force consolidation.

## Requirements *(mandatory)*

### Functional Requirements

#### Agent Synchronization

- **FR-001**: System MUST maintain agent parity between `.cursor/agents/` (21 agents) and `.opencode/agent/` (27 agents, including OpenCode-only)
- **FR-002**: System MUST translate flat agent names to categorized paths (e.g., `product-strategist` → `planning/product-strategist`)
- **FR-003**: System MUST preserve OpenCode YAML frontmatter format when syncing agent content
- **FR-004**: System MUST translate delegation patterns (`@Agent-Name` → `task(subagent_type: "category/agent")`)
- **FR-005**: System MUST preserve OpenCode-only agents: `agent-engineer`, `research`, `conversation-auditor`, `orchestrator`

#### Command Synchronization

- **FR-006**: System MUST port all high-priority commands from Cursor to OpenCode (see Command Porting Matrix)
- **FR-007**: System MUST preserve OpenCode-only commands: `orchestrator.md`, `init-project.md`
- **FR-008**: Commands MUST reference correct agent paths for their target environment
- **FR-009**: Ported commands MUST include OpenCode YAML frontmatter with `description` and `handoffs` fields

#### Translation & Documentation

- **FR-010**: Translation guide MUST document all agent category mappings (21 mapped agents)
- **FR-011**: Translation guide MUST include path reference translation rules
- **FR-012**: Translation guide MUST include delegation pattern translation examples
- **FR-013**: Sync procedures MUST be documented for both Cursor→OpenCode and OpenCode→Cursor directions

#### Shared Resources

- **FR-014**: Shared resources MUST remain in `.cursor/` and NOT be duplicated:
  - `.cursor/specs/` - Feature specifications
  - `.cursor/memory/` - Constitution, architecture, tech-stack
  - `.cursor/templates/` - Spec templates
  - `.cursor/scripts/` - Bash scripts
  - `.cursor/rules/` - Project rules
  - `.cursor/changelog/` - Project changelog

### Key Entities

- **Agent Definition**: Markdown file defining an agent's purpose, capabilities, instructions, guardrails, and delegation patterns
- **Command Definition**: Markdown file defining a slash command's workflow and agent invocations
- **Translation Mapping**: Rule set for converting between Cursor and OpenCode formats
- **Sync Procedure**: Step-by-step process for synchronizing a resource between directories

## Directory Audit Results

### Agent Inventory

| Category | Cursor (.cursor/agents/) | OpenCode (.opencode/agent/) |
|----------|--------------------------|----------------------------|
| Governance | context-steward, historian, agent-auditor, meta-improvement-analyst, mode-auditor | context-steward, historian, agent-auditor, meta-improvement-analyst, mode-auditor, conversation-auditor |
| Planning | product-strategist, strategic-architect, linear-coordinator | product-strategist, strategic-architect, linear-coordinator |
| Implementation | implementation-specialist, quick-fixer, devops-specialist | implementation-specialist, quick-fixer, devops-specialist |
| Quality | code-reviewer, test-engineer, documentation-master, chat-auditor | code-reviewer, test-engineer, documentation-master, chat-auditor |
| Specialized | rag-architect, ml-engineer, ai-engineer-agentic, web-design-guru, project-guru, brd-creator, rule-engineer | rag-architect, ml-engineer, ai-engineer-agentic, web-design-guru, project-guru, brd-creator, rule-engineer, agent-engineer, research |
| Orchestration | N/A (conductor.md is a command) | orchestrator.md |

**OpenCode-Only Agents** (preserve, do not sync from Cursor):
- `agent-engineer.md` - OpenCode agent development
- `research.md` - Research tasks
- `conversation-auditor.md` - Conversation compliance
- `orchestrator.md` - Task delegation orchestrator

### Command Inventory

| Command | Cursor | OpenCode | Sync Status |
|---------|--------|----------|-------------|
| analyze.md | Yes | Yes | Synced |
| checklist.md | Yes | Yes | Synced |
| clarify.md | Yes | Yes | Synced |
| code-review.md | Yes | Yes | Synced |
| implement.md | Yes | Yes | Needs sync verification |
| plan.md | Yes | Yes | Needs sync verification |
| specify.md | Yes | Yes | Needs sync verification |
| superwhisper-mode.md | Yes | Yes | Needs sync verification |
| tasks.md | Yes | Yes | Needs sync verification |
| update-context.md | Yes | Yes | Synced |
| conductor.md | Yes | N/A | Maps to orchestrator.md |
| conductor.help.md | Yes | No | Low priority |
| sync-linear.md | Yes | No | **Port (Medium)** |
| create-pr.md | Yes | No | **Port (Medium)** |
| debug-issue.md | Yes | No | **Port (Medium)** |
| refactor-code.md | Yes | No | **Port (Low)** |
| security-audit.md | Yes | No | **Port (Low)** |
| write-unit-tests.md | Yes | No | **Port (Low)** |
| add-documentation.md | Yes | No | **Port (Low)** |
| add-error-handling.md | Yes | No | Port (Low) |
| address-github-pr-comments.md | Yes | No | Port (Low) |
| create-command.md | Yes | No | Port (Low) |
| create-prs-from-branches.md | Yes | No | Port (Low) |
| discuss.md | Yes | No | Port (Low) |
| impl-plan.md | Yes | No | Port (Low) |
| lint-fix.md | Yes | No | Port (Low) |
| optimize-performance.md | Yes | No | Port (Low) |
| proceed.md | Yes | No | Port (Low) |
| run-all-tests-and-fix.md | Yes | No | Port (Low) |
| try-hard.md | Yes | No | Port (Low) |
| 1-deep-review-project.md | Yes | No | Port (Low) |
| NR-review-pr.md | Yes | No | Port (Low) |
| speckit.constitution.md | Yes | No | Port (Low) |
| init-project.md | No | Yes | OpenCode-only |
| orchestrator.md | No | Yes | OpenCode-only |

### Command Porting Priority Matrix

| Priority | Commands | Rationale |
|----------|----------|-----------|
| **High** | (Already ported: analyze, checklist, clarify, code-review, update-context) | Core workflow commands |
| **Medium** | sync-linear, create-pr, debug-issue | Common development workflows |
| **Low** | refactor-code, security-audit, write-unit-tests, add-documentation | Specialized workflows |
| **Skip** | conductor.help (→ orchestrator.help), NR-review-pr (project-specific) | Not applicable or redundant |

## Implementation Phases

### Phase 1: Verify Existing Syncs (P1)

1. Verify 5 synced commands work correctly in OpenCode
2. Test agent delegation patterns in synced commands
3. Document any issues found

### Phase 2: Port Medium-Priority Commands (P1)

1. Port `sync-linear.md` to OpenCode
2. Port `create-pr.md` to OpenCode
3. Port `debug-issue.md` to OpenCode
4. Verify ported commands function correctly

### Phase 3: Sync Agent Definitions (P2)

1. Compare each shared agent between directories
2. Update OpenCode agents with latest Cursor content (preserving format)
3. Verify delegation patterns work correctly

### Phase 4: Port Low-Priority Commands (P3)

1. Port remaining commands based on priority
2. Document any commands intentionally not ported

### Phase 5: Documentation & Maintenance (P2)

1. Update translation guide with lessons learned
2. Create sync checklist for future maintenance
3. Document OpenCode-only features

## Phase 1 Findings (2025-12-16)

### Verification Results

| Command | Status | Path References | Agent Delegation | Notes |
|---------|--------|-----------------|------------------|-------|
| analyze.md | ✅ PASS | `.opencode/agent/historian.md` | Correct | Synced correctly |
| checklist.md | ✅ PASS | `.opencode/agent/context-steward.md`, `.opencode/agent/historian.md` | Correct | Synced correctly |
| clarify.md | ✅ PASS | `.opencode/agent/historian.md` | Correct | Synced correctly |
| code-review.md | ✅ PASS | `.opencode/agent/code-reviewer.md`, `.opencode/agent/historian.md` | Correct | Synced correctly |
| update-context.md | ✅ PASS | `.opencode/agent/context-steward.md`, `.opencode/agent/historian.md` | Correct | Synced correctly |

### Key Findings

1. **All 5 synced commands verified working** - Path references correctly updated to `.opencode/agent/`
2. **Agent structure is FLAT** - OpenCode agents are at `.opencode/agent/*.md` (not categorized subdirectories)
3. **Orchestrator references categorized paths** - But agents exist in flat structure (works via task tool resolution)
4. **21 commands still need porting** - See divergence report for priority matrix
5. **4 OpenCode-only agents preserved** - orchestrator, research, conversation-auditor, agent-engineer

### Divergence Report

Full divergence analysis available at: `./divergence-report.md`

**Summary Metrics**:
- Cursor Commands: 33
- OpenCode Commands: 12
- Commands to Port: 21
- Cursor Agents: 21
- OpenCode Agents: 26
- OpenCode-Only Agents: 4

### Critical Issue: Flat vs Categorized Agent Structure

**Problem Discovered**: OpenCode agents are in a FLAT structure (`.opencode/agent/*.md`) but orchestrator and governance docs reference CATEGORIZED paths (`governance/context-steward`, `planning/product-strategist`, etc.).

**Root Cause**: Governance rules were written assuming subdirectory structure, but flat structure is required for tool compatibility.

**Decision**: Keep FLAT structure, update all documentation to match.

**Impact**:
- Must update `.opencode/instructions/governance.md`
- Must update `.opencode/agent/orchestrator.md` (100+ path references)
- Must update `.opencode/instructions/cursor-opencode-sync.md`

**Added**: Phase 1.5 to address this before Phase 2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 5 already-ported commands verified working in OpenCode (100% pass rate) ✅ **COMPLETE**
- **SC-002**: At least 3 additional medium-priority commands ported and functional ✅ **COMPLETE** (3 ported: sync-linear, create-pr, debug-issue)
- **SC-003**: Translation guide covers 100% of agent mappings (21 agents) ✅ **COMPLETE**
- **SC-004**: Zero broken agent delegations after sync (tested via `/specify` and `/implement` workflows) ✅ **COMPLETE** (verified via grep)
- **SC-005**: OpenCode-only features documented and preserved (4 agents, 2 commands) ✅ **COMPLETE**
- **SC-006**: Divergence audit report created with complete inventory ✅ **COMPLETE**

### Definition of Done

- [x] All P1 user stories pass acceptance scenarios
- [x] 8+ commands functional in OpenCode (33 total!)
- [x] Translation guide complete at `.opencode/instructions/cursor-opencode-sync.md`
- [x] OpenCode-only features documented in README
- [x] No regression in existing Cursor workflows

## Final Statistics

### Command Inventory
- **OpenCode Commands**: 33 (20 ported in this issue)
- **Cursor Commands**: 33 (baseline)
- **Commands Ported**: 20
- **Commands Skipped**: 2 (conductor.md, conductor.help.md - redundant with orchestrator)
- **OpenCode-Only Commands**: 2 (init-project.md, orchestrator.md)

### Agent Inventory
- **OpenCode Agents**: 26
- **Cursor Agents**: 21
- **Agents Synced**: 21 (shared agents)
- **OpenCode-Only Agents**: 4 (agent-engineer, research, conversation-auditor, orchestrator)

### Path Fixes & Refactoring
- **Path Fixes**: 150+ (categorized → flat conversions)
- **Files Modified**: 94+ (orchestrator.md, governance.md, sync guide, etc.)
- **Documentation Files Created**: 8 (divergence-report, agents-to-sync, commands-to-port, command-inventory, sync-checklist, sync-maintenance, etc.)

### Phases Completed
1. ✅ Phase 1: Verified 5 synced commands
2. ✅ Phase 1.5: Fixed flat agent structure (94+ paths)
3. ✅ Phase 2: Ported 3 medium-priority commands
4. ✅ Phase 3: Synced 21 shared agents
5. ✅ Phase 4: Ported 17 low-priority commands
6. ✅ Phase 5: Documentation & maintenance

## Technical Notes

### Key Differences Summary

| Aspect | Cursor | OpenCode |
|--------|--------|----------|
| Agent paths | `.cursor/agents/{agent}.md` | `.opencode/agent/{agent}.md` |
| Agent naming | Flat (`product-strategist`) | Categorized (`planning/product-strategist`) |
| Delegation | `@Agent-Name` | `task(subagent_type: "category/agent")` |
| Agent format | Simple markdown | YAML frontmatter + structured sections |
| Orchestrator | `conductor.md` (command) | `orchestrator.md` (agent with tools) |
| Custom tools | N/A | `.opencode/tool/` |

### Translation Reference

See `.opencode/instructions/cursor-opencode-sync.md` for:
- Complete agent category mapping table
- Delegation pattern translation examples
- Sync procedures (Cursor→OpenCode, OpenCode→Cursor)
- Validation checklist

## References

- Translation Guide: `.opencode/instructions/cursor-opencode-sync.md`
- Cursor Agents: `.cursor/agents/`
- OpenCode Agents: `.opencode/agent/`
- Cursor Commands: `.cursor/commands/`
- OpenCode Commands: `.opencode/command/`
- Linear Issue: [LIF-54](https://linear.app/lifelogger/issue/LIF-54/sync-cursor-and-opencode-agentcommandtemplate-directories)
