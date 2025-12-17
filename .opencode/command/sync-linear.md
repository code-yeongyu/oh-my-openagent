---
description: Sync local Linear artifacts (tasks, issues) with Linear workspace via Linear MCP.
---

# Sync Linear

## Overview

Sync local Linear artifacts (tasks.md, linear/ issues) with Linear workspace. Supports bidirectional sync with local-first policy.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Detect spec folder**
   - Use current branch to find spec folder in `.cursor/specs/`
   - Or use `--spec-dir` argument if provided
   - Verify `tasks.md` exists or `linear/` directory exists

2. **Read local artifacts**
   - Read `tasks.md` for task breakdown
   - Read `linear/` directory for local issue files
   - Read `sync-log.md` if exists (tracks previous syncs)

3. **Determine sync direction**
   - **Local → Linear**: Create Linear issues from local tasks/issues
   - **Linear → Local**: Update local files from Linear issues
   - **Bidirectional**: Sync both directions (default)

4. **Engage Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path for Linear sync work
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/linear/` structure

5. **Engage Linear Coordinator**:
   - Read `.opencode/agent/linear-coordinator.md`
   - **LOCAL-FIRST POLICY**: Always read local files first
   - **ASK USER** before creating/updating Linear issues
   - Use Linear MCP tools:
     - `linear_list_issues` - Find existing issues
     - `linear_create_issue` - Create new issues (with confirmation)
     - `linear_update_issue` - Update existing issues (with confirmation)
     - `linear_create_comment` - Add comments

6. **Update sync-log.md**
   - Document all Linear writes (issues created/updated)
   - Include: issue IDs, URLs, timestamps
   - Track sync direction and scope

7. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Linear sync work
   - Include: sync direction, issues synced, Linear URLs

8. **Report completion**
   - Sync summary, issues created/updated, Linear URLs, sync-log updated

## Sync Modes

### Local → Linear

- Read `tasks.md` or `linear/` local files
- Create Linear issues from local tasks
- **REQUIRES USER CONFIRMATION** before creating

### Linear → Local

- Read Linear issues (by issue ID or query)
- Update local `tasks.md` or `linear/` files
- Sync issue status, comments, assignments

### Bidirectional (Default)

- Sync both directions
- Match local tasks to Linear issues by ID
- Update both sides to match

## Local-First Policy

**CRITICAL**: Linear Coordinator MUST:
1. **Read local files FIRST** before Linear operations
2. **ASK USER** before creating/updating Linear issues
3. **Document** all Linear writes in `sync-log.md`
4. **Preserve** local files as source of truth

## References

- Tasks: `{SPEC_DIR}/tasks.md`
- Linear Directory: `{SPEC_DIR}/linear/`
- Sync Log: `{SPEC_DIR}/linear/sync-log.md`
- Context Steward: `.opencode/agent/context-steward.md`
- Linear Coordinator: `.opencode/agent/linear-coordinator.md`
- Historian: `.opencode/agent/historian.md`
