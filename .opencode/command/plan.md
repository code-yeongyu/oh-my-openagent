---
description: Create implementation plan from feature specification.
step: plan
requires:
  - spec.md
produces:
  - plan.md
next: tasks
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Create Tasks
    agent: tasks
    prompt: Create tasks from this plan
  - label: Implement Feature
    agent: implement
    prompt: Implement this feature according to the plan
---

## User Input

```text
$ARGUMENTS
```

---

## Step 0: Validate Prerequisites (FIRST)

Before proceeding, validate that prerequisites are met:

### 0.1 Check for Spec Folder

```bash
# Auto-detect spec folder from git branch
BRANCH=$(git branch --show-current)
```

Then search for matching spec folder:
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

Check that `spec.md` exists in the spec folder:

**If `spec.md` missing**:
```
❌ Preflight blocked: Required artifact not found: spec.md

Fixes:
  → Run /specify to create spec.md
```

### 0.3 Check for Resume Context

If `workflow-state.json` exists in spec folder, show resume message:
```
📋 Resuming from: Planning (1 steps complete, last updated {date})
📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}
```

---

## Step 1: Load Full Context

### 1.1 Load Project Context

```
read_context({ section: "all" })
```

Extract and store:
- `TECH_STACK`: Languages, frameworks, databases
- `ARCHITECTURE`: Pattern (layered, hexagonal, etc.)
- `CONVENTIONS`: Coding standards, naming conventions

### 1.2 Load Spec Content

Read the specification:
```
read({ filePath: "{SPEC_DIR}/spec.md" })
```

### 1.3 Load Constitution (if exists)

```
read({ filePath: ".cursor/memory/constitution.md" })
```

---

## Step 2: Delegate to Strategic Planner Agent

```
call_omo_agent(
  subagent_type="strategic-planner",
  run_in_background=false,
  prompt="""
  TASK: Create implementation plan for feature specification
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_DIR}/spec.md
  PLAN_FILE: {SPEC_DIR}/plan.md
  
  PROJECT CONTEXT:
  - Tech Stack: {TECH_STACK}
  - Architecture Pattern: {ARCHITECTURE}
  - Conventions: {CONVENTIONS}
  
  SPEC CONTENT:
  {spec.md content}
  
  CONSTITUTION GATES:
  {constitution.md content if exists}
  
  TOOLS TO USE:
  - Use `context7_get-library-docs` for library research
  - Use `grep_app_searchGitHub` for implementation examples
  - Use `lsp_workspace_symbols` to understand existing code patterns
  - Use `ast_grep_search` to find similar implementations in codebase
  
  REQUIREMENTS:
  - Create technical architecture that satisfies spec requirements
  - Include data models, API contracts, project structure
  - Reference constitution gates for compliance
  - Document technical decisions and tradeoffs
  - Research libraries using context7 MCP
  
  DELIVERABLES:
  - plan.md with complete implementation plan
  - Technical Context section (language, dependencies, storage, testing, platform)
  - Data Model (Phase 1 design)
  - API Contracts (if applicable)
  - Project Structure (documentation and source code layout)
  - Also create architecture docs in docs/architecture/ if applicable
  """
)
```

---

## Step 3: Update Linear Status

```
linear_update_status({
  issueId: "{ISSUE-ID}",
  status: "in_progress",
  comment: "Implementation plan created. Ready for task breakdown."
})
```

---

## Step 4: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "plan",
  linearStatus: "in_progress"
})
```

---

## Step 5: Report Completion

```
✅ Implementation plan complete!

📁 Plan: {SPEC_DIR}/plan.md
🔗 Linear: {ISSUE-ID} (In Progress)

**Next steps:**
- Run `/tasks` to create task breakdown
- Or run `/implement` to start implementation directly
```

---

## Plan Structure

The plan should include:

| Section | Description |
|---------|-------------|
| Summary | From spec.md |
| Technical Context | Language, dependencies, storage, testing, platform |
| Constitution Check | Gates from `.cursor/memory/constitution.md` |
| Research | Phase 0 findings using context7 |
| Data Model | Phase 1 design |
| Contracts | Phase 1 API contracts |
| Project Structure | Documentation and source code layout |
| Complexity Tracking | If constitution violations |

---

## Research Tools

Agents should use these tools for research:

| Tool | Purpose |
|------|---------|
| `context7_get-library-docs` | Official library documentation |
| `grep_app_searchGitHub` | Find real-world implementation examples |
| `deepwiki_ask_question` | Ask about specific repository patterns |
| `websearch_exa_web_search_exa` | General web search for solutions |

---

## References

- Spec: `{SPEC_DIR}/spec.md`
- Template: `.cursor/templates/plan-template.md`
- Constitution: `.cursor/memory/constitution.md`
