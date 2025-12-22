---
description: Create task breakdown from implementation plan.
step: tasks
requires:
  - spec.md
  - plan.md
produces:
  - tasks.md
next: implement
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Implement Tasks
    agent: implement
    prompt: Implement these tasks
---

## User Input

```text
$ARGUMENTS
```

---

## Step 0: Validate Prerequisites (FIRST)

### 0.1 Check for Spec Folder

```bash
# Auto-detect spec folder from git branch
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

Check that both `spec.md` AND `plan.md` exist:

**If `spec.md` missing**:
```
❌ Preflight blocked: Required artifact not found: spec.md

Fixes:
  → Run /specify to create spec.md
```

**If `plan.md` missing**:
```
❌ Preflight blocked: Required artifact not found: plan.md

Fixes:
  → Run /plan to create plan.md
```

### 0.3 Check for Resume Context

If `workflow-state.json` exists, show resume message:
```
📋 Resuming from: Task Breakdown (2 steps complete, last updated {date})
📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}
```

---

## Step 1: Load Full Context

### 1.1 Load Project Context

```
read_context({ section: "all" })
```

### 1.2 Load Spec and Plan Content

```
read({ filePath: "{SPEC_DIR}/spec.md" })
read({ filePath: "{SPEC_DIR}/plan.md" })
```

### 1.3 Analyze Codebase for Complexity Estimation

Use AST analysis to understand codebase complexity:
```
ast_grep_search({
  pattern: "export function $NAME($$$) { $$$ }",
  lang: "typescript",
  paths: ["src/"]
})
```

This helps estimate task complexity based on similar existing code.

---

## Step 2: Delegate to Task Planner Agent

```
call_omo_agent(
  subagent_type="task-planner",
  run_in_background=false,
  prompt="""
  TASK: Create task breakdown from implementation plan
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_DIR}/spec.md
  PLAN_FILE: {SPEC_DIR}/plan.md
  TASKS_FILE: {SPEC_DIR}/tasks.md
  
  PROJECT CONTEXT:
  - Tech Stack: {from read_context}
  - Architecture: {from read_context}
  - Codebase Complexity: {from ast_grep analysis}
  
  SPEC CONTENT:
  {spec.md content}
  
  PLAN CONTENT:
  {plan.md content}
  
  TOOLS TO USE:
  - Use `lsp_document_symbols` to understand file structure
  - Use `ast_grep_search` to find patterns for estimation
  - Use `grep` to find related code sections
  
  REQUIREMENTS:
  - Create phased task breakdown
  - Phase 1: Setup (shared infrastructure)
  - Phase 2: Foundational (blocking prerequisites)
  - Phase 3+: User Story phases (each independently testable)
  - Phase N: Polish & Cross-Cutting Concerns
  - Each task should have: ID, description, estimate, dependencies
  
  ESTIMATION GUIDELINES:
  - Base estimates on similar existing code patterns
  - Include buffer for testing (20% of implementation time)
  - Mark uncertain estimates with [?]
  
  LINEAR INTEGRATION (LOCAL-FIRST):
  - Create tasks.md locally first
  - ASK USER before creating issues in Linear via MCP
  - If user approves, use Linear tools to create sub-issues
  
  DELIVERABLES:
  - tasks.md with complete task breakdown
  - Task table with ID, Task, Status, Estimate, Notes
  - Checkpoints for each phase
  - Dependency graph (which tasks block which)
  """
)
```

---

## Step 3: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "tasks",
  linearStatus: "in_progress"
})
```

---

## Step 4: Report Completion

```
✅ Task breakdown complete!

📁 Tasks: {SPEC_DIR}/tasks.md
📊 Summary: {X} tasks in {Y} phases
⏱️ Estimated effort: {total_hours}h
🔗 Linear: {ISSUE-ID}

**Task Overview:**
- Phase 1 (Setup): {count} tasks
- Phase 2 (Foundation): {count} tasks
- Phase 3+ (Features): {count} tasks
- Phase N (Polish): {count} tasks

**Next steps:**
- Run `/implement` to start implementation
- Or create Linear sub-issues for team assignment
```

---

## Task Organization

Tasks MUST be organized by user story:
- Phase 1: Setup (shared infrastructure)
- Phase 2: Foundational (blocking prerequisites)
- Phase 3+: User Story 1, 2, 3... (each independently testable)
- Phase N: Polish & Cross-Cutting Concerns

Each user story phase should include:
- Goal and Independent Test
- Tests (if requested in spec)
- Implementation tasks
- Checkpoint validation

---

## Task Table Format

```markdown
| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T001 | Setup project structure | Not Started | 1h | - | Foundation |
| T002 | Create data models | Not Started | 2h | T001 | Core types |
| T003 | Implement API endpoints | Not Started | 4h | T002 | REST API |
```

---

## Linear Integration

**LOCAL-FIRST POLICY**:
1. Create `tasks.md` locally first
2. Optionally create Linear issues locally in `{SPEC_DIR}/linear/`
3. **ASK USER** before creating issues in Linear via MCP
4. If user approves:
   ```
   linear_create_issue({
     title: "{Task Title}",
     description: "{Task Description}",
     team: "{TEAM}",
     labels: ["type:task"],
     parentId: "{PARENT_ISSUE_ID}"
   })
   ```

---

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Template: `.cursor/templates/tasks-template.md`
