# Feature Specification: Workflow Consistency Remediation

**Feature ID**: `LIF-51-refactor-workflow-consistency`  
**Created**: 2025-12-13  
**Status**: Draft  
**Input**: Comprehensive review of pending branch changes for workflow orchestration inconsistencies

## User Scenarios & Testing

### User Story 1 - Remove Jira Contradictions (Priority: P1)

As a developer, I need the workflow system to be consistent with Linear-only project management, so that I don't encounter conflicting references to deprecated Jira workflows.

**Why this priority**: Jira contradictions create confusion and can lead to incorrect workflow execution. This blocks all other remediation work.

**Independent Test**: Verify no Jira/mcp-atlassian references exist in canonical workflow files (commands, agents, templates) outside of archived locations.

**Acceptance Scenarios**:

1. **Given** a canonical workflow file, **When** I search for Jira references, **Then** none are found (except in `_archive/`)
2. **Given** a template file, **When** I check for Jira directory references, **Then** it uses `linear/` instead of `jira/`

---

### User Story 2 - Fix Legacy Command Forwarding (Priority: P1)

As a developer, I need `speckit.*` commands to truly forward to canonical commands, so that legacy commands don't accidentally execute deprecated `.specify/` workflows.

**Why this priority**: Broken forwarding defeats the purpose of migration and can cause incorrect file layouts.

**Independent Test**: Verify all `speckit.*` commands are minimal aliases that defer to canonical commands without executing `.specify/` scripts.

**Acceptance Scenarios**:

1. **Given** a `speckit.*` command file, **When** I read its contents, **Then** it contains only forwarding instructions (no `.specify/` script references)
2. **Given** a legacy command invocation, **When** it executes, **Then** it uses canonical command workflows

---

### User Story 3 - Repair Broken References (Priority: P2)

As a developer, I need all rule and template references to point to existing files, so that agents and commands can execute without errors.

**Why this priority**: Broken references cause failures when agents try to load dependencies.

**Independent Test**: Verify every referenced `.cursor/rules/...` and `.cursor/templates/...` path exists.

**Acceptance Scenarios**:

1. **Given** a custom agent file, **When** I check rule references, **Then** all referenced rules exist
2. **Given** a custom agent file, **When** I check template references, **Then** all referenced templates exist

---

### User Story 4 - Migrate Legacy Specs Folder (Priority: P2)

As a developer, I need all active features under `.cursor/specs/`, so that the canonical spec root is consistent.

**Why this priority**: Having specs in two locations creates confusion about which is authoritative.

**Independent Test**: Verify `specs/` folder is migrated to `.cursor/specs/` and deprecated.

**Acceptance Scenarios**:

1. **Given** the legacy `specs/` folder, **When** I check its contents, **Then** it's migrated to `.cursor/specs/` with deprecation notice
2. **Given** a reference to `specs/`, **When** I check it, **Then** it points to `.cursor/specs/`

---

### User Story 5 - Align Validation Tooling (Priority: P3)

As a developer, I need validation scripts to reflect the current workflow structure, so that reports are accurate.

**Why this priority**: Out-of-sync validation tooling provides misleading information.

**Independent Test**: Verify validation scripts extract and report on `.cursor/specs/` structure.

**Acceptance Scenarios**:

1. **Given** a validation script, **When** it runs, **Then** it extracts paths from `.cursor/specs/` (not `chat-context/`)
2. **Given** a validation report, **When** I read it, **Then** it reflects Linear-only and `.cursor/specs/` structure

---

### Edge Cases

- What happens if a file references both Jira and Linear? (Should be Linear-only)
- What if a referenced template doesn't exist? (Should create it or remove reference)
- What if `specs/` folder has uncommitted changes? (Should migrate safely)

## Requirements

### Functional Requirements

- **FR-001**: System MUST remove all Jira/mcp-atlassian references from canonical workflow files
- **FR-002**: System MUST archive or delete `jira-coordinator.md` agent
- **FR-003**: System MUST convert all `speckit.*` commands to minimal aliases
- **FR-004**: System MUST remove all `.specify/` script references from `speckit.*` commands
- **FR-005**: System MUST fix all broken rule references in custom agents
- **FR-006**: System MUST fix all broken template references in custom agents
- **FR-007**: System MUST migrate `specs/001-polymarket-trading-bot/` to `.cursor/specs/001-feat-polymarket-trading-bot/`
- **FR-008**: System MUST update validation scripts to target `.cursor/specs/` structure
- **FR-009**: System MUST regenerate validation reports with updated structure

## Success Criteria

### Measurable Outcomes

- **SC-001**: Zero Jira/mcp-atlassian references in canonical files (outside `_archive/`)
- **SC-002**: All `speckit.*` commands are minimal aliases (< 20 lines each)
- **SC-003**: All referenced `.cursor/rules/...` paths exist
- **SC-004**: All referenced `.cursor/templates/...` paths exist
- **SC-005**: Legacy `specs/` folder migrated and deprecated
- **SC-006**: Validation scripts extract `.cursor/specs/` paths correctly
- **SC-007**: Validation reports reflect Linear-only workflow

