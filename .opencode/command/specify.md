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

---

## Step 0: Load Project Context (FIRST)

Before any other action, load project context to understand the tech stack and conventions:

```
read_context({ section: "all" })
```

**Use this context for**:
- Understanding project type (web-app, CLI, library, etc.)
- Tech stack decisions (languages, frameworks)
- Architecture patterns to follow
- Coding conventions for the spec

---

## Step 1: Linear-First Requirement (MANDATORY)

**If Linear MCP is available**: 

1. **Search for existing issues**:
   ```
   linear_list_issues({ query: "{FEATURE_KEYWORDS}", limit: 5 })
   ```

2. **If issue found**: 
   - Get branch name: `linear_branch({ issueId: "{ISSUE-ID}" })`
   - Store: `BRANCH_NAME`, `ISSUE_ID`, `ISSUE_URL`

3. **If issue has parent**: 
   - Ask user: "Use parent feature branch" vs "Standalone on child issue branch"

4. **If no issue found**:
   - Create placeholder issue:
     ```
     linear_create_issue({
       title: "{Feature Title}",
       description: "{Brief summary}",
       team: "{TEAM}",
       labels: ["type:feature"]
     })
     ```
   - **REQUIRE user confirmation** - if user declines, **REFUSE to proceed**

5. **Get branch name** after issue exists:
   ```
   linear_branch({ issueId: "{ISSUE-ID}" })
   ```
   - Returns: `{ branchName, issueTitle, issueUrl, issueIdentifier }`

**If Linear MCP is NOT available**: 
- Fall back to sequential numbering: `{NNN}-{type}-{slug}`
- Only allowed when Linear MCP is unavailable (offline mode)

---

## Step 2: Create Git Worktree from `dev` (MANDATORY)

```bash
# Fetch latest dev branch
git fetch origin dev

# Get repo name from current directory
REPO_NAME=$(basename "$(pwd)")

# Create worktree with new branch based on dev
WORKTREE_PATH="../${REPO_NAME}-worktrees/{BRANCH_NAME}"
mkdir -p "../${REPO_NAME}-worktrees"
git worktree add -b "{BRANCH_NAME}" "$WORKTREE_PATH" origin/dev
```

**If worktree already exists**:
- Check: `git worktree list | grep "{BRANCH_NAME}"`
- If exists, use existing path
- Report to user: "Worktree already exists at {path}"

**Store for subsequent steps**: `WORKTREE_PATH`

---

## Step 3: Create Spec Folder in Worktree

```
create_spec_folder({
  featureName: "{feature-name}",
  linearIssue: "{ISSUE-ID}",
  type: "{type}",
  basePath: "{WORKTREE_PATH}"
})
```

**Tool returns**:
- `path`: Relative path (e.g., `.cursor/specs/LIF-123-feat-user-auth`)
- `folderId`: Folder ID
- `createdFiles`: Template files created (spec.md, plan.md, tasks.md, status.md)

**Set variables**:
- `SPEC_DIR` = `{WORKTREE_PATH}/{result.path}`
- `SPEC_FILE` = `{SPEC_DIR}/spec.md`

---

## Step 4: Delegate to Product Strategist Agent

```
call_omo_agent(
  subagent_type="product-strategist",
  run_in_background=false,
  prompt="""
  TASK: Create feature specification for: {FEATURE_DESCRIPTION}
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_FILE}
  LINEAR_ISSUE: {ISSUE-ID}
  WORKTREE_PATH: {WORKTREE_PATH}
  
  PROJECT CONTEXT:
  - Project Type: {from read_context}
  - Tech Stack: {from read_context}
  - Architecture: {from read_context}
  - Conventions: {from read_context}
  
  CONTEXT:
  - Spec folder already created with template files
  - Update spec.md at SPEC_FILE path (template already exists)
  - Also create Mintlify docs in docs/requirements/ if applicable
  
  REQUIREMENTS:
  - Focus on WHAT users need and WHY
  - Avoid HOW to implement (no tech stack, APIs, code structure)
  - Written for business stakeholders, not developers
  - Make informed guesses, document assumptions
  - Maximum 3 [NEEDS CLARIFICATION] markers
  
  DELIVERABLES:
  - Updated spec.md with full specification
  - User stories with acceptance criteria
  - Success criteria (measurable, technology-agnostic)
  """
)
```

---

## Step 5: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "specify",
  linearStatus: "todo"
})
```

This enables session continuity and resume messages.

---

## Step 6: Instruct User to Switch to Worktree (FINAL STEP)

**Report completion summary**:
- Linear issue: `{ISSUE-ID}` with link
- Branch: `{BRANCH_NAME}` (based on `dev`)
- Worktree: `{WORKTREE_PATH}`
- Spec file: `{SPEC_FILE}`

**Instruct user**:
```
✅ Specification complete! Your development environment is ready.

**Next steps:**
1. Close this OpenCode session (Ctrl+C or type 'exit')
2. Run this command to switch to your new worktree:

   cd {WORKTREE_PATH} && opencode

3. Continue with `/plan` to create the implementation plan
```

**CRITICAL**: Do NOT continue with `/plan` in current session. User MUST switch to worktree first.

---

## Linear Branch Policy

When Linear is used:
- Git branch MUST be `issue.branchName` from Linear (exact match)
- Branch MUST be created from `origin/dev` as base
- Worktree MUST be created at `../{REPO_NAME}-worktrees/{BRANCH_NAME}`
- Spec folder MUST be `{ISSUE-ID}-{type}-{name-slug}` format

---

## Worktree Policy

**Why worktrees?**
- Isolated development environment per feature
- Clean context for OpenCode (no cross-contamination)
- Easy parallel work on multiple features
- Simple cleanup when feature is complete

**Worktree location**: `../{REPO_NAME}-worktrees/{BRANCH_NAME}`

**Worktree cleanup** (after feature merged):
```bash
git worktree remove ../{REPO_NAME}-worktrees/{BRANCH_NAME}
git branch -d {BRANCH_NAME}
```

---

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
