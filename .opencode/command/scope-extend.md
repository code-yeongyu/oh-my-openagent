---
description: Extend scope by creating a sub-issue from a parent issue with linked branch and spec folder.
step: specify
requires: []
produces:
  - spec.md
next: plan
linear_status: todo
category: workflow
primary: false
handoffs:
  - label: Build Technical Plan
    agent: plan
    prompt: Create a plan for the spec
  - label: Continue Parent Work
    prompt: Return to parent issue work
    send: true
---

**Create todos from the numbered steps below, then execute in order.**

## Purpose

Handle "enhancement discovered during review" pattern:
- Parent issue is in review or complete
- New related scope identified
- Need sub-issue with branch off parent branch (not dev)

## User Input

```text
$ARGUMENTS
```

**Expected format**: `{PARENT-ISSUE-ID} {feature description}`
**Example**: `LIF-73 Add rich metadata to memory_list tool`

---

## Step 0: Parse Input and Load Context

1. **Parse arguments**:
   - Extract `PARENT_ISSUE_ID` (e.g., `LIF-73`)
   - Extract `FEATURE_DESCRIPTION` (remaining text)

2. **Load project context**:
   ```
   read_context({ section: "all" })
   ```

3. **Validate parent issue exists**:
   ```
   linear_get_issue({ id: "{PARENT_ISSUE_ID}" })
   ```
   - Store: `PARENT_TITLE`, `PARENT_DESCRIPTION`, `PARENT_STATUS`, `PARENT_URL`

4. **Get parent branch name**:
   ```
   linear_branch({ issueId: "{PARENT_ISSUE_ID}" })
   ```
   - Store: `PARENT_BRANCH_NAME`

---

## Step 1: Create Sub-Issue in Linear (MANDATORY)

```
linear_create_issue({
  title: "{FEATURE_DESCRIPTION}",
  description: "## Context\n\nSub-issue of {PARENT_ISSUE_ID}: {PARENT_TITLE}\n\n## Summary\n\n{FEATURE_DESCRIPTION}\n\n---\n\n_Created via /scope-extend from parent issue._",
  team: "{TEAM_FROM_PARENT}",
  parentId: "{PARENT_ISSUE_UUID}",
  labels: ["type:enhancement", "scope-extension"]
})
```

**Store**: `CHILD_ISSUE_ID`, `CHILD_ISSUE_UUID`

**Get child branch name**:
```
linear_branch({ issueId: "{CHILD_ISSUE_ID}" })
```
- Store: `CHILD_BRANCH_NAME`

---

## Step 2: Determine Worktree Strategy

**Check if currently in parent worktree**:
```bash
CURRENT_DIR=$(pwd)
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
```

**Two scenarios**:

### Scenario A: Currently in parent worktree
- Parent worktree exists at current location
- Create child branch directly off current HEAD
- Create child worktree as sibling

### Scenario B: In main repo
- Need to find or verify parent worktree exists
- Create child worktree off parent branch

**Execute based on scenario**:

```bash
# Get repo root name
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREES_DIR="../${REPO_NAME}-worktrees"

# Check if parent worktree exists
PARENT_WORKTREE="${WORKTREES_DIR}/{PARENT_BRANCH_NAME}"

if [ -d "$PARENT_WORKTREE" ]; then
  echo "Parent worktree found at: $PARENT_WORKTREE"
else
  echo "ERROR: Parent worktree not found. Run /specify on parent issue first."
  exit 1
fi
```

---

## Step 3: Create Child Worktree from Parent Branch

```bash
# Ensure we have latest parent branch
cd "{PARENT_WORKTREE}"
git fetch origin

# Create child worktree branching from parent
CHILD_WORKTREE="${WORKTREES_DIR}/{CHILD_BRANCH_NAME}"
git worktree add -b "{CHILD_BRANCH_NAME}" "$CHILD_WORKTREE" HEAD

echo "Created child worktree at: $CHILD_WORKTREE"
echo "Based on parent branch: {PARENT_BRANCH_NAME}"
```

**Store**: `CHILD_WORKTREE_PATH`

**If worktree already exists**:
- Check: `git worktree list | grep "{CHILD_BRANCH_NAME}"`
- If exists, use existing path
- Report to user: "Child worktree already exists at {path}"

---

## Step 4: Create Spec Folder in Child Worktree

```
create_spec_folder({
  featureName: "{feature-slug-from-description}",
  linearIssue: "{CHILD_ISSUE_ID}",
  type: "feat",
  basePath: "{CHILD_WORKTREE_PATH}"
})
```

**Store**:
- `SPEC_DIR` = `{CHILD_WORKTREE_PATH}/{result.path}`
- `SPEC_FILE` = `{SPEC_DIR}/spec.md`

---

## Step 5: Pre-populate Spec with Parent Context

**Read parent spec if exists**:
```bash
PARENT_SPEC="{PARENT_WORKTREE}/.cursor/specs/{PARENT_ISSUE_ID}-*/spec.md"
if ls $PARENT_SPEC 1>/dev/null 2>&1; then
  PARENT_SPEC_CONTENT=$(cat $PARENT_SPEC)
fi
```

**Write initial spec.md with context**:

```markdown
# {FEATURE_DESCRIPTION}

## Parent Context

> This is a scope extension of [{PARENT_ISSUE_ID}]({PARENT_URL}): {PARENT_TITLE}
> 
> Parent Status: {PARENT_STATUS}
> Parent Branch: `{PARENT_BRANCH_NAME}`

## Relationship to Parent

[Describe how this enhancement relates to and extends the parent feature]

---

## Summary

{FEATURE_DESCRIPTION}

## Background

[Why was this scope extension identified? What gap does it fill?]

## User Stories

### Story 1: [Primary User Story]

**As a** [user type]
**I want** [capability]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]

## Success Criteria

1. [Measurable outcome 1]
2. [Measurable outcome 2]

## Out of Scope

- [What this does NOT include]

## Open Questions

- [NEEDS CLARIFICATION] [Question 1]

---

_Generated by /scope-extend from {PARENT_ISSUE_ID}_
```

---

## Step 6: Persist Workflow State

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "specify",
  linearStatus: "todo"
})
```

---

## Step 7: Report and Instruct User

**Report completion summary**:

```
## Scope Extension Complete

### Sub-Issue Created
- **Issue**: [{CHILD_ISSUE_ID}]({CHILD_ISSUE_URL})
- **Parent**: [{PARENT_ISSUE_ID}]({PARENT_URL}) ({PARENT_STATUS})

### Branch Hierarchy
```
{PARENT_BRANCH_NAME}  (parent)
  └── {CHILD_BRANCH_NAME}  (child - NEW)
```

### Worktree Created
- **Path**: {CHILD_WORKTREE_PATH}
- **Spec**: {SPEC_FILE}

### Next Steps

1. **Switch to child worktree**:
   ```bash
   cd {CHILD_WORKTREE_PATH} && opencode
   ```

2. **Complete the specification** - flesh out the pre-populated spec.md

3. **Continue with `/plan`** to create implementation plan

### When Child Work is Complete

After merging child PR:
1. Child changes will be in parent branch lineage
2. Update parent PR if needed
3. Clean up: `git worktree remove {CHILD_WORKTREE_PATH}`
```

**CRITICAL**: Do NOT continue work in current session. User MUST switch to child worktree.

---

## Branch Merge Strategy

```
dev
  └── {PARENT_BRANCH_NAME}  (PR to dev)
        └── {CHILD_BRANCH_NAME}  (PR to parent OR dev)
```

**Option A: PR child → parent** (recommended if parent not yet merged)
- Child changes flow into parent PR
- Single merge to dev

**Option B: PR child → dev** (if parent already merged)
- Child is independent
- Merges directly to dev

---

## Error Handling

### Parent Issue Not Found
```
ERROR: Parent issue {PARENT_ISSUE_ID} not found in Linear.
Please verify the issue ID and try again.
```

### Parent Worktree Not Found
```
ERROR: Parent worktree for {PARENT_BRANCH_NAME} not found.

The parent issue must have a worktree created first.
Run `/specify` on the parent issue, or manually create the worktree:

  git worktree add -b {PARENT_BRANCH_NAME} ../repo-worktrees/{PARENT_BRANCH_NAME} origin/dev
```

### Already in Child Worktree
```
INFO: You appear to already be in a child worktree.
Current branch: {CURRENT_BRANCH}

To create another scope extension, run this command from the parent worktree.
```
