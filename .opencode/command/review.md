---
description: Review implementation from spec folder context.
step: review
requires:
  - spec.md
produces:
  - reviews/
next: test
linear_status: in_review
category: workflow
primary: true
handoffs:
  - label: Write Tests
    agent: test
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

### 0.2 Verify Required Artifacts

Check that `spec.md` exists for requirements context.

### 0.3 Check for Resume Context

If `workflow-state.json` exists, show resume message:
```
📋 Resuming from: Code Review (4 steps complete, last updated {date})
📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}
```

---

## Step 1: Load Full Context

### 1.1 Load Project Context

```
read_context({ section: "conventions" })
```

### 1.2 Load Spec Artifacts

```
read({ filePath: "{SPEC_DIR}/spec.md" })
read({ filePath: "{SPEC_DIR}/plan.md" })
read({ filePath: "{SPEC_DIR}/tasks.md" })
```

### 1.3 Identify Changed Files

Find files modified in this branch:
```bash
git diff --name-only origin/dev...HEAD
```

Or find implementation files:
```
glob({ pattern: "src/**/*.ts", path: "." })
```

---

## Step 2: Run Automated Checks (BEFORE Agent Review)

### 2.1 Type Check All Modified Files

```
lsp_diagnostics({ filePath: "{each_modified_file}", severity: "error" })
```

### 2.2 Check for Code Patterns

```
ast_grep_search({
  pattern: "console.log($$$)",
  lang: "typescript",
  paths: ["src/"]
})
```

### 2.3 Find Unused Exports

```
lsp_find_references({
  filePath: "{file}",
  line: {export_line},
  character: {export_col}
})
```

---

## Step 3: Delegate to Oracle Agent for Code Review

```
call_omo_agent(
  subagent_type="oracle",
  run_in_background=false,
  prompt="""
  TASK: Comprehensive code review for feature implementation
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_DIR}/spec.md
  PLAN_FILE: {SPEC_DIR}/plan.md
  TASKS_FILE: {SPEC_DIR}/tasks.md
  
  PROJECT CONVENTIONS:
  {from read_context}
  
  CHANGED FILES:
  {list of modified files}
  
  AUTOMATED CHECK RESULTS:
  - Type Errors: {lsp_diagnostics results}
  - Console Logs: {ast_grep results}
  - Dead Code: {unused exports}
  
  SPEC CONTENT:
  {spec.md content}
  
  PLAN CONTENT:
  {plan.md content}
  
  TOOLS TO USE:
  - Use `lsp_find_references` to check impact of changes
  - Use `lsp_goto_definition` to understand dependencies
  - Use `ast_grep_search` to find anti-patterns
  - Use `grep` to find TODO/FIXME comments
  - Use `lsp_code_actions` to find available quick fixes
  
  REVIEW FOCUS:
  1. Requirements Alignment - Does implementation satisfy spec requirements?
  2. Architecture Adherence - Does code follow plan.md architecture?
  3. Security - Are there security vulnerabilities?
  4. Code Quality - Is code maintainable, readable, tested?
  5. Performance - Are there performance concerns?
  6. Edge Cases - Are edge cases handled?
  7. Convention Compliance - Does code follow project conventions?
  
  REVIEW CHECKLIST:
  - [ ] No type errors (from lsp_diagnostics)
  - [ ] No console.log statements in production code
  - [ ] No unused exports
  - [ ] Error handling for all external calls
  - [ ] Input validation where needed
  - [ ] No hardcoded secrets or credentials
  
  DELIVERABLES:
  - Review findings written to {SPEC_DIR}/reviews/{date}-review.md
  - Include: passed checks, issues found, recommendations
  - Severity levels: critical, major, minor, suggestion
  """
)
```

---

## Step 4: Update Linear Status

```
linear_update_status({
  issueId: "{ISSUE-ID}",
  status: "in_review",
  comment: "Code review complete. {X} issues found ({critical} critical, {major} major)."
})
```

---

## Step 5: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "review",
  linearStatus: "in_review"
})
```

---

## Step 6: Report Completion

```
✅ Code review complete!

📁 Review: {SPEC_DIR}/reviews/{date}-review.md
🔗 Linear: {ISSUE-ID} (In Review)

**Review Summary:**
- ✅ Passed: 12 checks
- ⚠️ Minor: 3 issues
- ❌ Major: 1 issue
- 🚨 Critical: 0 issues

**Issues Found:**
1. [Major] Missing error handling in api.ts:45
2. [Minor] Console.log in utils.ts:23
3. [Minor] Unused import in types.ts:5
4. [Minor] Consider extracting function in handler.ts:78

**Next steps:**
- Address major issues before merging
- Run `/test` to add test coverage
- Create PR when ready
```

---

## Review Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `lsp_diagnostics` | Find type errors | Before review |
| `lsp_find_references` | Check change impact | During review |
| `lsp_goto_definition` | Understand dependencies | During review |
| `ast_grep_search` | Find anti-patterns | Pattern check |
| `grep` | Find TODOs/FIXMEs | Completeness check |
| `lsp_code_actions` | Find quick fixes | Suggestions |

---

## Review Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| Critical | Security vulnerability, data loss risk | Block merge |
| Major | Bug, missing functionality | Fix before merge |
| Minor | Code quality, maintainability | Should fix |
| Suggestion | Nice to have improvement | Optional |
