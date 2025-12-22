---
description: Create or update the feature specification from a natural language feature description.
step: specify
requires: []
produces:
  - spec.md
next: plan
linear_status: todo
category: workflow
primary: true
handoffs: 
  - label: Build Technical Plan
    agent: plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: clarify
    prompt: Clarify specification requirements
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Linear-First Requirement (MANDATORY)**:
   - **If Linear MCP is available**: 
     - **MUST** create or select a placeholder parent Linear issue BEFORE proceeding
     - Search for existing Linear issues matching the description using `mcp_Linear_list_issues`
     - If issue found: Use `issue.branchName` and issue ID for folder naming
     - If issue has parent: Prompt user: "Use parent feature branch" vs "Standalone on child issue branch"
     - **If no issue found**: 
       - Propose creating a minimal placeholder parent issue
       - **REQUIRE user confirmation** - if user declines, **REFUSE to proceed** (stop execution)
       - Placeholder issue should have:
         - Clear title (enough to identify feature)
         - Short summary (1-2 sentences)
         - Correct type label (`type:feature`, `type:bug`, etc.)
         - Appropriate team assignment
     - **CRITICAL**: No spec folder or artifacts can be created without a Linear issue existing first
   - **If Linear MCP is NOT available**: 
     - Fall back to non-Linear mode (sequential numbering: `{NNN}-{type}-{slug}`)
     - Only allowed when Linear MCP is unavailable (offline mode)

2. **Create Git Worktree from `dev` (MANDATORY)**:
   - **Get branch name**: Use `linear_branch` tool or `issue.branchName` from step 1
   - **Determine repo name**: Extract from current directory (e.g., `oh-my-opencode`)
   - **Create worktree**:
     ```bash
     # Fetch latest dev branch
     git fetch origin dev
     
     # Get repo name from current directory
     REPO_NAME=$(basename "$(pwd)")
     
     # Create worktree with new branch based on dev
     # Worktree location: ../{repo-name}-worktrees/{branch-name}
     WORKTREE_PATH="../${REPO_NAME}-worktrees/{BRANCH_NAME}"
     mkdir -p "../${REPO_NAME}-worktrees"
     git worktree add -b "{BRANCH_NAME}" "$WORKTREE_PATH" origin/dev
     ```
   - **If worktree already exists**: 
     - Check if branch exists: `git branch --list "{BRANCH_NAME}"`
     - If exists, use existing worktree path
     - Report to user: "Worktree already exists at {path}"
   - **Store worktree path** for subsequent steps: `WORKTREE_PATH`
   - **All subsequent file operations happen in the worktree**, not the main repo

3. **Create Spec Folder in Worktree** (use `create_spec_folder` tool):
   - **Call the tool**:
     ```
     create_spec_folder({
       featureName: "{feature-name}",
       linearIssue: "{ISSUE-ID}",  // e.g., "LIF-123"
       type: "{type}",              // e.g., "feat", "fix", "refactor"
       basePath: "{WORKTREE_PATH}"  // e.g., "../oh-my-opencode-worktrees/eru/lif-123-feature"
     })
     ```
   - **Tool returns**:
     - `path`: Relative path (e.g., `.cursor/specs/LIF-123-feat-user-auth`)
     - `fullPath`: Absolute path in worktree
     - `folderId`: Folder ID (e.g., `LIF-123-feat-user-auth`)
     - `createdFiles`: List of template files created (spec.md, plan.md, tasks.md, status.md)
   - Set `SPEC_DIR` = `{result.fullPath}`
   - Set `SPEC_FILE` = `{SPEC_DIR}/spec.md`

4. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path: `SPEC_DIR` (in worktree)
   - Ensure path follows `{WORKTREE_PATH}/.cursor/specs/{SPEC_DIR_NAME}/` structure

5. **Engage Product Strategist Agent**:
   - Read `.opencode/agent/product-strategist.md` (COMPLETE, no offset/limit)
   - Adopt Product Strategist persona
   - **Update** `spec.md` at `SPEC_FILE` path (template already created by tool in step 3)
   - Follow Product Strategist steps exactly
   - **NOTE**: Mintlify docs (`docs/requirements/`) created in worktree as well

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Product Strategist work (in worktree)
   - Include: mode, scope, files created, decisions made

7. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "specify",
     linearStatus: "todo"
   })
   ```
   This enables session continuity and resume messages.

8. **Instruct User to Switch to Worktree (FINAL STEP)**:
   - **Report completion summary**:
     - Linear issue: `{ISSUE-ID}` with link
     - Branch: `{BRANCH_NAME}` (based on `dev`)
     - Worktree: `{WORKTREE_PATH}`
     - Spec file: `{SPEC_FILE}`
   - **Instruct user to close OpenCode and switch**:
     ```
     ✅ Specification complete! Your development environment is ready.
     
     **Next steps:**
     1. Close this OpenCode session (Ctrl+C or type 'exit')
     2. Run this command to switch to your new worktree:
     
        cd {WORKTREE_PATH} && opencode
     
     3. Continue with `/plan` to create the implementation plan
     ```
   - **CRITICAL**: Do NOT continue with `/plan` in current session
   - User MUST switch to worktree first for proper isolation

## Linear Branch Policy

**CRITICAL**: When Linear is used:
- Git branch MUST be `issue.branchName` from Linear (exact match)
- Branch MUST be created from `origin/dev` as base
- Worktree MUST be created at `../{REPO_NAME}-worktrees/{BRANCH_NAME}`
- Spec folder MUST be `{ISSUE-ID}-{type}-{name-slug}` format
- If issue has parent, prompt user for branch strategy (see step 1)

## Worktree Policy

**Why worktrees?**
- Isolated development environment per feature
- Clean context for OpenCode (no cross-contamination)
- Easy parallel work on multiple features
- Simple cleanup when feature is complete

**Worktree location**: `../{REPO_NAME}-worktrees/{BRANCH_NAME}`
- Sibling to main repo, named `{repo-name}-worktrees`
- Example: If main repo is `/code/oh-my-opencode`, worktree is `/code/oh-my-opencode-worktrees/eru/lif-123-feature-name`

**Worktree cleanup** (after feature merged):
```bash
git worktree remove ../{REPO_NAME}-worktrees/{BRANCH_NAME}
git branch -d {BRANCH_NAME}
```

## Agent Integration

When Product Strategist agent is invoked:
- **DO NOT** create spec folder (already created in step 3)
- **USE** `SPEC_DIR` in the worktree (from step 3)
- **RESPECT** worktree path for all file operations
- **CALL** Context Steward before writing files
- **CALL** Historian after completing work
- **SUPPORT** dual workflow: Creates both `.cursor/specs/` and `docs/requirements/` in worktree

## General Guidelines

- Focus on **WHAT** users need and **WHY**
- Avoid HOW to implement (no tech stack, APIs, code structure)
- Written for business stakeholders, not developers
- DO NOT create checklists embedded in spec (use `/checklist` command)

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns
2. **Document assumptions**: Record reasonable defaults in Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist

## Success Criteria Guidelines

Success criteria must be:
1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:
- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"

**Bad examples** (implementation-focused):
- "API response time is under 200ms" (too technical)
- "Database can handle 1000 TPS" (implementation detail)
- "React components render efficiently" (framework-specific)
