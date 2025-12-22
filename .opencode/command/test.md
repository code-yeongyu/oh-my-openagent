---
description: Write and run tests for implementation from spec folder context.
step: test
requires:
  - spec.md
produces:
  - tests/
next: null
linear_status: in_review
category: workflow
primary: true
handoffs:
  - label: Review Code
    agent: review
    prompt: Review the implementation
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

Check that `spec.md` exists for test scenarios.

### 0.3 Check for Resume Context

If `workflow-state.json` exists, show resume message:
```
📋 Resuming from: Testing (5 steps complete, last updated {date})
📁 Spec: {SPEC_DIR}
🔗 Linear: {ISSUE-ID}
```

---

## Step 1: Load Full Context

### 1.1 Load Project Context

```
read_context({ section: "all" })
```

Extract test configuration:
- Test framework (jest, vitest, bun:test, etc.)
- Test directory structure
- Coverage requirements

### 1.2 Load Spec Artifacts

```
read({ filePath: "{SPEC_DIR}/spec.md" })
read({ filePath: "{SPEC_DIR}/plan.md" })
read({ filePath: "{SPEC_DIR}/tasks.md" })
```

### 1.3 Identify Implementation Files to Test

Find files that need tests:
```bash
git diff --name-only origin/dev...HEAD -- "*.ts" "*.tsx"
```

Or search for implementation:
```
glob({ pattern: "src/**/*.ts", path: "." })
```

### 1.4 Find Existing Test Patterns

```
ast_grep_search({
  pattern: "describe($NAME, function() { $$$ })",
  lang: "typescript",
  paths: ["tests/"]
})
```

---

## Step 2: Discover Test Context

### 2.1 Find Existing Test Files

```
glob({ pattern: "tests/**/*.test.ts", path: "." })
```

### 2.2 Analyze Test Patterns

```
ast_grep_search({
  pattern: "it($NAME, $$$)",
  lang: "typescript",
  paths: ["tests/"]
})
```

### 2.3 Find Mock Patterns

```
grep({
  pattern: "mock|jest.fn|vi.fn|stub",
  include: "*.test.ts",
  path: "tests/"
})
```

### 2.4 Compile Test Context

```
TEST_CONTEXT = {
  framework: "{from read_context or package.json}",
  test_dir: "tests/",
  patterns: [from ast_grep],
  mocking_style: [from grep],
  existing_tests: [from glob]
}
```

---

## Step 3: Delegate to Test Specialist Agent

```
call_omo_agent(
  subagent_type="test-specialist",
  run_in_background=false,
  prompt="""
  TASK: Write and run tests for feature implementation
  
  SPEC_DIR: {SPEC_DIR}
  SPEC_FILE: {SPEC_DIR}/spec.md
  PLAN_FILE: {SPEC_DIR}/plan.md
  TASKS_FILE: {SPEC_DIR}/tasks.md
  
  PROJECT CONTEXT:
  - Tech Stack: {from read_context}
  - Test Framework: {TEST_CONTEXT.framework}
  - Test Directory: {TEST_CONTEXT.test_dir}
  
  TEST PATTERNS (from existing tests):
  {TEST_CONTEXT.patterns}
  
  MOCKING STYLE:
  {TEST_CONTEXT.mocking_style}
  
  FILES TO TEST:
  {implementation files from git diff}
  
  SPEC CONTENT (acceptance criteria):
  {spec.md content}
  
  PLAN CONTENT (architecture boundaries):
  {plan.md content}
  
  TOOLS TO USE:
  - Use `lsp_document_symbols` to find functions to test
  - Use `lsp_goto_definition` to understand dependencies
  - Use `ast_grep_search` to find similar test patterns
  - Use `grep_app_searchGitHub` for testing best practices
  - Use `context7_get-library-docs` for test framework docs
  
  TEST COVERAGE:
  1. Unit Tests - Test individual functions/components
  2. Integration Tests - Test component interactions
  3. Acceptance Tests - Verify spec acceptance criteria
  
  REQUIREMENTS:
  - Follow existing test patterns exactly
  - Use project's test framework and mocking style
  - Test happy path + edge cases from spec
  - Achieve meaningful coverage (not 100% for its own sake)
  - Each user story should have acceptance tests
  
  TEST STRUCTURE:
  - One test file per implementation file
  - Group tests by function/method
  - Clear test names describing behavior
  
  DELIVERABLES:
  - Test plan written to {SPEC_DIR}/testing/test-plan.md
  - Test files per project conventions
  - Run tests and capture results
  - Coverage report
  """
)
```

---

## Step 4: Run Tests and Capture Results

```bash
# Run tests with coverage
bun test --coverage
# Or: npm test -- --coverage
# Or: pnpm test --coverage
```

---

## Step 5: Update Linear Status

```
linear_update_status({
  issueId: "{ISSUE-ID}",
  status: "in_review",
  comment: "Tests complete. {passed}/{total} passing, {coverage}% coverage."
})
```

---

## Step 6: Persist Workflow State (REQUIRED)

```
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "test",
  linearStatus: "in_review"
})
```

---

## Step 7: Report Completion

```
✅ Testing complete!

📁 Test Plan: {SPEC_DIR}/testing/test-plan.md
🔗 Linear: {ISSUE-ID}

**Test Results:**
- ✅ Passed: 24 tests
- ❌ Failed: 0 tests
- ⏭️ Skipped: 2 tests

**Coverage:**
- Statements: 87%
- Branches: 82%
- Functions: 91%
- Lines: 86%

**New Test Files:**
- tests/feature/new-module.test.ts (12 tests)
- tests/integration/api.test.ts (8 tests)
- tests/acceptance/user-stories.test.ts (6 tests)

**Next steps:**
- Feature is ready for merge
- Run `/create-pr` to create pull request
- Or fix any failing tests first
```

---

## Test Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `lsp_document_symbols` | Find testable functions | Test planning |
| `ast_grep_search` | Find test patterns | Pattern matching |
| `grep` | Find mock patterns | Mocking style |
| `context7_get-library-docs` | Test framework docs | Best practices |
| `grep_app_searchGitHub` | Real-world test examples | Complex scenarios |

---

## Test Coverage Goals

| Coverage Type | Target | Description |
|---------------|--------|-------------|
| Statement | 80%+ | Lines of code executed |
| Branch | 75%+ | Decision paths taken |
| Function | 90%+ | Functions called |
| Line | 80%+ | Lines covered |

**Note**: Coverage is a guide, not a goal. Meaningful tests > high coverage numbers.
