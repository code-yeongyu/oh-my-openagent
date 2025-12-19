---
category: git
description: Analyze active branches and create PRs to GitHub with Linear integration.
---

# Create PRs from Active Branches

## Overview

Automatically analyze active branches (branches with commits ahead of main/master), create a PR plan, and create GitHub pull requests. Integrates with Linear to link PRs to issues and update issue status.

**Level**: 3 (Loops & Automation)

## User Input

```text
$ARGUMENTS
```

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Git repository with remote configured
- Linear MCP tools available (optional, for Linear integration)
- Branches pushed to remote

## Variables

**`$ARGUMENTS`** (optional):
- `--base <branch>` - Base branch for comparison (default: `main`)
- `--pattern <glob>` - Branch name pattern filter (default: all branches)
- `--dry-run` - Generate plan only, don't create PRs
- `--skip-linear` - Skip Linear integration
- `--exclude-pattern <glob>` - Exclude branches matching pattern (default: `*-wip,*-draft`)

## Steps

### Phase 1: Discovery and Analysis

1. **Get base branch**
   - Parse `--base` from `$ARGUMENTS` or default to `main`
   - Verify base branch exists: `git show-ref --verify --quiet refs/heads/{base}`
   - If not found, try `master` as fallback

2. **List active branches**
   - Get all local branches: `git branch --format='%(refname:short)'`
   - Filter out base branch (`main`/`master`)
   - Filter by `--pattern` if provided
   - Exclude branches matching `--exclude-pattern`
   - For each branch:
     - Check if pushed to remote: `git ls-remote --heads origin {branch}`
     - Check commits ahead: `git rev-list --count {base}..{branch}`
     - Skip if 0 commits ahead

3. **Check existing PRs**
   - For each active branch:
     - Check if PR exists: `gh pr list --head {branch} --json number,title,url`
     - Skip branch if PR already exists (log and continue)

4. **Detect Linear issue IDs**
   - For each branch, extract Linear issue ID from branch name pattern: `{username}/{ISSUE-ID}-*`
   - Examples: `eru/LIF-51-*`, `hello/LIF-51-*`
   - Store mapping: `branch → issue_id`

### Phase 2: Gather Branch Information

5. **For each active branch, collect:**
   - **Commit summary**: Last 5-10 commits: `git log {base}..{branch} --oneline --no-merges`
   - **File changes**: `git diff --stat {base}..{branch}`
   - **Change count**: Files changed, insertions, deletions
   - **Linear issue** (if detected):
     - Use `linear_get_issue` with issue ID
     - Extract: title, description, labels, priority, status

6. **Determine PR metadata**
   - **Title**: Use Linear issue title if available, else generate from branch name
   - **Type**: Detect from branch name/commits (`feat`, `fix`, `refactor`, `docs`, `chore`)
   - **Description**: Build from Linear issue description, commit summaries, file change summary
   - **Labels**: Extract from Linear issue labels, add type label

### Phase 3: Create PR Plan

7. **Generate PR plan document**
   - Create structured plan with:
     - Branch name
     - PR title (proposed)
     - Change summary (files, commits)
     - Linear issue link (if available)
     - Estimated review complexity

8. **Determine review order**
   - Sort branches by priority:
     1. Linear issue priority (Urgent → High → Normal → Low)
     2. Change size (smallest first for quick reviews)
     3. Branch age (oldest first)
   - Create ordered list for user review

9. **Present plan to user** (if `--dry-run` or before creating)
   - Display ordered list of PRs to be created
   - Ask for confirmation if not `--dry-run`

### Phase 4: Create PRs

10. **For each branch in review order:**
    
    a. **Prepare PR description**
       - Build markdown description with summary, changes, and related links
    
    b. **Create PR via GitHub CLI**
       - Command: `gh pr create --base {base} --head {branch} --title "{title}" --body "{description}"`
       - Capture PR URL from output
    
    c. **Link to Linear** (if not `--skip-linear` and issue detected)
       - Update Linear issue status: `In Progress → In Review`
       - Add PR link as comment
    
    d. **Handle errors gracefully**
       - If PR creation fails: log error, continue with next branch
       - Track successes/failures/skips

### Phase 5: Summary Report

11. **Generate final summary**
    - **Created**: List of PRs created with URLs
    - **Skipped**: Branches skipped (existing PRs, no changes, etc.)
    - **Failed**: Branches that failed with error messages
    - **Review order**: Ordered list for user

12. **Call Historian** (GOVERNANCE):
    - Read `.opencode/agent/historian.md`
    - Create changelog entry for PR creation work
    - Include: PRs created count, branches processed

## Error Handling

- **Branch has existing PR**: Skip, log, continue
- **Branch has conflicts**: Include in plan with warning, don't create PR
- **Branch has no commits ahead**: Skip, log, continue
- **GitHub CLI not available**: Provide manual instructions, exit gracefully
- **Linear MCP unavailable**: Continue without Linear integration, log warning

## Examples

**Basic usage:**
```
/create-prs-from-branches
```

**Dry run with custom base:**
```
/create-prs-from-branches --dry-run --base develop
```

**Filter specific branches:**
```
/create-prs-from-branches --pattern "feature/*" --exclude-pattern "*-wip"
```

## Checklist

- [ ] All active branches identified
- [ ] Existing PRs detected and skipped
- [ ] Linear issues linked (if available)
- [ ] PR plan generated with review order
- [ ] PRs created successfully (or dry-run completed)
- [ ] Linear issues updated (if applicable)
- [ ] Summary report presented to user

## References

- Linear Coordinator: `.opencode/agent/linear-coordinator.md`
- Historian: `.opencode/agent/historian.md`
- Linear Workflow: `.opencode/instructions/linear-workflow.md`
