# Comprehensive Linear Issue Update Tool

**Linear Issue**: [LIF-102](https://linear.app/lifelogger/issue/LIF-102/extend-linear-tooling-with-comprehensive-issue-update-capability)
**Created**: 2025-12-28
**Status**: Ready for Planning

## Overview

Add a `linear_update_issue` tool to oh-my-opencode that enables AI agents to comprehensively update Linear issue fields beyond just status changes. This tool will support updating title, description, priority, estimate, due date, assignee, labels, and project/cycle assignments through a single, unified interface with partial-update semantics.

## Problem Statement

### Current State

The oh-my-opencode plugin currently provides six Linear tools:
- `linear_branch`: Get git branch name for an issue
- `linear_update_status`: Update issue workflow status only (todo, in_progress, in_review, done, canceled)
- `linear_create_issue`: Create new issues with title, description, team, labels, and parent
- `linear_archive_issue`: Archive issues
- `linear_get_issue`: Retrieve issue details
- `linear_add_comment`: Add comments to issues

### Issues

1. **Limited update capability**: The existing `linear_update_status` tool only modifies the workflow state, leaving agents unable to update other issue fields during implementation workflows.

2. **Fragmented workflows**: Agents must leave OpenCode to update issue details like description, priority, or assignee, breaking the seamless development experience.

3. **Stale issue metadata**: As implementation progresses and scope becomes clearer, agents cannot update estimates, priorities, or descriptions to reflect current understanding.

4. **Manual label management**: Agents cannot add or remove labels to reflect implementation progress (e.g., adding "needs-review" or removing "blocked").

5. **Assignment gaps**: Agents cannot reassign issues or update due dates based on workload or timeline changes.

## User Stories

### US-1: As an AI development agent
I want to update an issue's description with implementation notes
So that the issue accurately reflects what was implemented and any decisions made.

**Acceptance Criteria:**
- [ ] Agent can update issue description via tool call
- [ ] Description supports Markdown formatting
- [ ] Previous description is not required to make an update (partial update)
- [ ] Updated description is reflected in Linear immediately

### US-2: As an AI development agent
I want to add or remove labels from an issue
So that I can track implementation progress and categorize work appropriately.

**Acceptance Criteria:**
- [ ] Agent can add one or more labels by name
- [ ] Agent can remove one or more labels by name
- [ ] Agent can replace all labels with a new set
- [ ] Add and remove operations cannot be combined with full replacement in same call
- [ ] Non-existent label names result in clear error messages

### US-3: As an AI development agent
I want to update issue priority and estimate
So that the issue reflects the actual complexity discovered during implementation.

**Acceptance Criteria:**
- [ ] Agent can set priority using standard values (urgent, high, medium, low, none)
- [ ] Agent can set story point estimate as a number
- [ ] Updates can be made independently (priority only, estimate only, or both)

### US-4: As an AI development agent
I want to update issue title
So that the issue title accurately reflects the work being done if scope changed.

**Acceptance Criteria:**
- [ ] Agent can update issue title
- [ ] Title update does not affect other fields

### US-5: As an AI development agent
I want to set or update the issue due date
So that deadlines are accurately reflected in the project timeline.

**Acceptance Criteria:**
- [ ] Agent can set due date using ISO 8601 format (YYYY-MM-DD)
- [ ] Agent can clear due date by setting to null
- [ ] Past dates are accepted (valid for backlog grooming)

### US-6: As an AI development agent
I want to assign or reassign an issue
So that the right person is responsible for the work.

**Acceptance Criteria:**
- [ ] Agent can assign issue to a user by ID or email
- [ ] Agent can unassign issue by setting assignee to null
- [ ] Invalid user references result in clear error messages

### US-7: As an AI orchestrator agent
I want to see what changes were made after an update
So that I can verify the update matched my intent and make informed decisions.

**Acceptance Criteria:**
- [ ] Response includes a changes array showing field, old value, and new value
- [ ] Response includes the full updated issue state
- [ ] Response indicates success or failure with clear messaging

## Requirements

### Functional Requirements

#### FR-1: Partial Update Semantics
The tool shall support partial updates where only provided fields are modified, leaving other fields unchanged. This prevents agents from accidentally overwriting data they didn't intend to modify.

#### FR-2: Single Unified Tool
The tool shall be a single `linear_update_issue` tool rather than multiple specialized tools (e.g., `linear_set_priority`, `linear_set_assignee`), reducing cognitive load and tool namespace pollution.

#### FR-3: Label Operations
The tool shall support three mutually exclusive label operations:
- **Add**: Add specified labels to existing labels
- **Remove**: Remove specified labels from existing labels
- **Set**: Replace all labels with the specified set

If both add/remove and set are provided in the same call, the tool shall return an error.

#### FR-4: Priority Values
The tool shall accept priority as either:
- Numeric values (0-4) matching Linear's internal scale
- String values ("urgent", "high", "medium", "low", "none") for readability

#### FR-5: Comprehensive Response
The tool shall return:
- Success/failure status
- Issue identifier and URL
- Array of changes made (field, from, to)
- Full current issue state after update
- Human-readable message
- Error details if failed

#### FR-6: Atomic Operations
All field updates in a single tool call shall be applied atomically - either all succeed or none are applied.

#### FR-7: Issue Resolution
The tool shall accept issue references in multiple formats:
- Issue identifier (e.g., "LIF-123")
- Full UUID

### Non-Functional Requirements

#### NFR-1: Error Handling
The tool shall provide clear, actionable error messages for:
- Invalid issue ID (not found)
- Invalid user ID/email for assignee
- Invalid label names
- Missing permissions
- API rate limiting
- Network failures

#### NFR-2: Logging
The tool shall log:
- Entry with issue ID and requested changes
- Success with changes summary
- Errors with full context

#### NFR-3: API Availability Check
The tool shall gracefully handle missing LINEAR_API_KEY environment variable with a clear error message.

#### NFR-4: Response Time
The tool should complete updates within typical API response times (< 5 seconds under normal conditions).

## Scope

### In Scope

- Updating issue title
- Updating issue description (Markdown supported)
- Setting issue priority
- Setting story point estimate
- Setting due date
- Assigning/unassigning issues
- Adding, removing, or replacing labels
- Returning comprehensive update results with change tracking

### Out of Scope

- Updating issue status (covered by existing `linear_update_status` tool)
- Creating issues (covered by existing `linear_create_issue` tool)
- Archiving issues (covered by existing `linear_archive_issue` tool)
- Moving issues between teams
- Assigning to projects or cycles (deferred to future enhancement)
- Creating parent/child relationships (deferred to future enhancement)
- Setting custom field values
- Batch updates to multiple issues
- Webhook integration for update verification
- Optimistic concurrency control with `updatedAt` timestamps (deferred to future enhancement)

## Assumptions

1. **API Stability**: Linear's GraphQL API `issueUpdate` mutation remains stable and supports the fields specified.

2. **Label Resolution**: Labels are resolved by name against both team-specific and workspace-wide labels, similar to existing `linear_create_issue` behavior.

3. **Permission Model**: The LINEAR_API_KEY has sufficient permissions to update all specified fields on issues within accessible teams.

4. **Existing Patterns**: The implementation will follow established patterns in `src/tools/linear/` for tool structure, error handling, and response formatting.

5. **Agent Behavior**: Agents will provide only the fields they intend to update, leveraging partial update semantics correctly.

## Dependencies

### Technical Dependencies

- Linear GraphQL API access via LINEAR_API_KEY environment variable
- Existing `api.ts` infrastructure for GraphQL query execution
- Existing tool patterns in `src/tools/linear/`

### External Dependencies

- Linear API availability and rate limits
- Valid user IDs/emails for assignee resolution
- Valid label names within the workspace

## Success Criteria

1. **Functional Completeness**: All specified fields can be updated successfully via the tool.

2. **Agent Usability**: Agents can update issues without needing to read full issue state first (partial updates work correctly).

3. **Error Clarity**: All error scenarios produce actionable error messages that agents can reason about.

4. **Change Visibility**: The response clearly shows what changed, enabling agents to verify their updates.

5. **Pattern Consistency**: The implementation follows existing Linear tool patterns and integrates seamlessly with the plugin architecture.

6. **Documentation**: Tool description clearly explains usage, parameters, and expected behavior.

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Linear API changes breaking update mutation | Low | High | Pin to stable API version, monitor Linear changelog |
| Agent misuse causing unintended data loss | Medium | Medium | Partial update semantics prevent accidental overwrites; clear documentation |
| Label name mismatches causing errors | Medium | Low | Return clear error messages with available label suggestions |
| Rate limiting during high-volume updates | Low | Medium | Implement retry logic with exponential backoff |
| Permission issues with certain fields | Low | Medium | Clear error messages indicating which field failed and why |

## Design Decisions

### DD-1: Single Tool vs Multiple Tools
**Decision**: Implement as a single `linear_update_issue` tool with all optional parameters.

**Context**: Could have created separate tools for each field (e.g., `linear_set_priority`, `linear_set_assignee`).

**Options Considered**:
1. Single unified tool with optional parameters
2. Multiple specialized tools per field
3. Grouped tools (metadata vs assignment vs labels)

**Rationale**: Single tool reduces cognitive load for agents, follows the existing `linear_create_issue` pattern which accepts multiple optional fields, and minimizes tool namespace pollution. Most update operations involve changing multiple fields together.

### DD-2: Label Operation Model
**Decision**: Use explicit `add`/`remove`/`set` operations for labels rather than simple array replacement.

**Context**: Agents commonly make mistakes when managing array-type fields.

**Options Considered**:
1. Simple array replacement (provide full label set)
2. Explicit add/remove/set operations

**Rationale**: Explicit operations prevent the common mistake where an agent intends to add a label but accidentally replaces all existing labels. The `set` option still allows full replacement when needed.

### DD-3: Priority Input Format
**Decision**: Accept both numeric (0-4) and string ("urgent", "high", etc.) priority values.

**Context**: Linear API uses numeric priorities internally.

**Options Considered**:
1. Numeric only (matches API)
2. String only (more readable)
3. Both formats accepted

**Rationale**: Accepting both formats improves agent usability while maintaining API compatibility. The tool will normalize string values to their numeric equivalents.

## Open Questions

1. **Project/Cycle Assignment**: Should this tool include project and cycle assignment in the initial release, or should these be added in a follow-up enhancement?
   - **Assumption**: Deferred to future enhancement to keep initial scope focused.

2. **Custom Fields**: Should the tool support updating custom fields defined in Linear workspaces?
   - **Assumption**: Out of scope for initial release due to complexity of custom field schema handling.

3. **Concurrent Update Handling**: Should the tool implement optimistic concurrency control using `updatedAt` timestamps to prevent lost updates?
   - **Assumption**: Deferred to future enhancement. Initial release assumes single-agent workflows where concurrent updates are rare.

---

## Appendix A: Linear API Reference

### IssueUpdateInput Fields (from Linear GraphQL Schema)

The following fields are available via Linear's `issueUpdate` mutation. This specification covers a subset focused on the most common agent workflows.

#### Core Fields (In Scope)
| Field | Type | Description |
|-------|------|-------------|
| `title` | `String` | The issue title |
| `description` | `String` | Issue description in Markdown format |
| `priority` | `Int (0-4)` | Priority level: 0=none, 1=urgent, 2=high, 3=medium, 4=low |
| `estimate` | `Int` | Story point estimate |
| `dueDate` | `TimelessDate` | Due date in YYYY-MM-DD format |
| `assigneeId` | `String` | UUID of user to assign (null to unassign) |
| `labelIds` | `[String!]` | Replace all labels with these UUIDs |
| `addedLabelIds` | `[String!]` | Add labels without removing existing |
| `removedLabelIds` | `[String!]` | Remove specific labels |

#### Additional Fields (Future Enhancement)
| Field | Type | Description |
|-------|------|-------------|
| `projectId` | `String` | UUID of associated project |
| `cycleId` | `String` | UUID of associated cycle/sprint |
| `parentId` | `String` | UUID of parent issue (for sub-issues) |
| `stateId` | `String` | UUID of workflow state (use `linear_update_status` instead) |
| `teamId` | `String` | UUID of team (moving between teams) |

### Priority Values Reference
| Value | Label | Description |
|-------|-------|-------------|
| `0` | No priority | Default/unset |
| `1` | Urgent | Highest priority |
| `2` | High | Important |
| `3` | Normal/Medium | Standard priority |
| `4` | Low | Lower priority |

### Label Best Practices
- Use `addedLabelIds`/`removedLabelIds` for incremental changes (recommended)
- Use `labelIds` only when replacing the entire label set
- Linear supports both team-specific and workspace-wide labels
