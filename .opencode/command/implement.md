---
description: Implement feature according to plan and tasks.
step: implement
requires:
  - spec.md
  - plan.md
  - tasks.md
produces:
  - implementation/
next: review
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Review Code
    agent: code-review
    prompt: Review the implementation
  - label: Write Tests
    agent: test-engineer
    prompt: Write tests for this implementation
---

## User Input

```text
$ARGUMENTS
```

---

## Step 0: Validate Prerequisites (FIRST)

### 0.1 Check for Spec Folder

```bash
BRANCH=$(git branch --show-current)
```

Search for matching spec folder:
```
glob({ pattern: ".cursor/specs/*", path: "." })
```

**If no spec folder found**:
```
❌ Preflight blocked: No spec folder found

Fixes:
  → Run /specify to create spec folder first
```

### 0.2 Verify Required Artifacts

Check that ALL required artifacts exist:
- `spec.md` - requirements context
- `plan.md` - architecture and design
- `tasks.md` - task breakdown

**If any missing**:
```
❌ Preflight blocked: Required artifact not found: {artifact}

Fixes:
  → Run /{previous_step} to create {artifact}
```

### 0.3 Check for Resume Context

If `workflow-state.json` exists, show resume message and current task:
```
📋 Resuming from: Implementation (3 steps complete, last updated {date})
📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}
📌 Current Task: T003 - Implement API endpoints
```

---

## Step 1: Load Full Context

### 1.1 Load Project Context

```
read_context({ section: "all" })
```

Extract:
- `TECH_STACK`: Languages, frameworks, databases
- `ARCHITECTURE`: Pattern and layers
- `CONVENTIONS`: Coding standards

### 1.2 Load Spec Artifacts

```
read({ filePath: "{SPEC_DIR}/spec.md" })
read({ filePath: "{SPEC_DIR}/plan.md" })
read({ filePath: "{SPEC_DIR}/tasks.md" })
```

---

## Step 2: Discover Feature Paths (NEW)

This step finds relevant code locations for the feature implementation.

### 2.1 Find Related Files by Feature Keywords

Extract keywords from spec/plan and search:

```
grep({
  pattern: "{feature_keyword}",
  include: "*.ts",
  path: "src/"
})
```

### 2.2 Find Similar Implementations

Use AST patterns to find similar code:

```
ast_grep_search({
  pattern: "export function $NAME($$$) { $$$ }",
  lang: "typescript",
  paths: ["src/"]
})
```

### 2.3 Find Related Types and Interfaces

```
lsp_workspace_symbols({
  query: "{feature_name}",
  filePath: "src/index.ts"
})
```

### 2.4 Map Module Structure

```
lsp_document_symbols({
  filePath: "src/index.ts"
})
```

### 2.5 Compile Feature Paths

Create a map of relevant locations:

```
FEATURE_PATHS = {
  related_files: [files from grep],
  similar_patterns: [files from ast_grep],
  types_to_extend: [from lsp_workspace_symbols],
  entry_points: [from lsp_document_symbols]
}
```

---

## Step 3: Delegate to Implementation Specialist Agent

```
call_omo_agent(
  subagent_type="implementation-specialist",
  run_in_background=false,
  prompt="""
  TASK: Implement feature according to plan and tasks
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_DIR}/spec.md
  PLAN_FILE: {SPEC_DIR}/plan.md
  TASKS_FILE: {SPEC_DIR}/tasks.md
  
  PROJECT CONTEXT:
  - Tech Stack: {TECH_STACK}
  - Architecture: {ARCHITECTURE}
  - Conventions: {CONVENTIONS}
  
  FEATURE PATHS (discovered):
  - Related Files: {FEATURE_PATHS.related_files}
  - Similar Patterns: {FEATURE_PATHS.similar_patterns}
  - Types to Extend: {FEATURE_PATHS.types_to_extend}
  - Entry Points: {FEATURE_PATHS.entry_points}
  
  SPEC CONTENT:
  {spec.md content}
  
  PLAN CONTENT:
  {plan.md content}
  
  TASKS CONTENT:
  {tasks.md content}
  
  TOOLS TO USE:
  - Use `lsp_goto_definition` to understand existing code
  - Use `lsp_find_references` before modifying shared code
  - Use `ast_grep_search` to find patterns to follow
  - Use `context7_get-library-docs` for library usage
  - Use `grep_app_searchGitHub` for real-world examples
  - Use `lsp_code_actions` for refactoring assistance
  - Use `lsp_diagnostics` to verify no errors after changes
  
  REQUIREMENTS:
  - Follow plan.md architecture exactly
  - Implement tasks from tasks.md in order
  - Respect user story organization (independent testability)
  - Write production-ready code (not prototypes)
  - Follow project coding standards from CONVENTIONS
  - Use existing patterns from FEATURE_PATHS
  
  QUALITY GATES:
  - Run lsp_diagnostics after each file edit
  - Verify no type errors before proceeding
  - Follow existing code patterns from similar files
  
  DELEGATION (if needed):
  - Delegate to backend-typescript for TypeScript backend work
  - Delegate to frontend-react for React frontend work
  - Delegate to other specialists as appropriate
  
  DELIVERABLES:
  - Implementation code in appropriate directories
  - Implementation notes in {SPEC_DIR}/implementation/
  - Updated task status in tasks.md
  """
)
```

---

## Step 4: Update Linear Status

```
linear_update_status({
  issueId: "{ISSUE-ID}",
  status: "in_progress",
  comment: "Implementation in progress. Tasks completed: {X}/{Y}"
})
```

---

## Step 5: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "implement",
  linearStatus: "in_progress"
})
```

---

## Step 6: Report Completion

```
✅ Implementation progress!

📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}

**Files Modified:**
- src/feature/new-module.ts (created)
- src/types/index.ts (modified)
- src/index.ts (modified)

**Tasks Completed:**
- [x] T001 - Setup project structure
- [x] T002 - Create data models
- [ ] T003 - Implement API endpoints (in progress)

**Quality Check:**
- lsp_diagnostics: ✅ 0 errors
- Type coverage: 100%

**Next steps:**
- Continue with remaining tasks
- Run `/review` when implementation complete
- Run `/test` to add test coverage
```

---

## Feature Path Discovery Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `grep` | Find files containing feature keywords | Initial discovery |
| `ast_grep_search` | Find similar code patterns | Pattern matching |
| `lsp_workspace_symbols` | Find types/interfaces by name | Type discovery |
| `lsp_document_symbols` | Get file structure | Module mapping |
| `lsp_goto_definition` | Jump to symbol source | During implementation |
| `lsp_find_references` | Find all usages | Before modifying |
| `lsp_diagnostics` | Check for errors | After each edit |

---

## Implementation Guidelines

- Follow plan.md architecture exactly
- Implement tasks from tasks.md in order
- Respect user story organization (independent testability)
- Use context7 for library patterns and best practices
- Write production-ready code (not prototypes)
- Follow project coding standards
- **ALWAYS run lsp_diagnostics after edits**

---

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Tasks: `{SPEC_DIR}/tasks.md` (required)
