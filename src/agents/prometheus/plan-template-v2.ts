/**
 * Prometheus Plan Template V2
 *
 * Enhanced markdown template structure for hierarchical work plans.
 * Supports nested task structures with parent/child relationships.
 * Format identifier: <!-- Plan-Format: 2 -->
 */

export const PROMETHEUS_PLAN_TEMPLATE_V2 = `<!-- Plan-Format: 2 -->

# {Plan Title}

## TL;DR

> **Quick Summary**: [1-2 sentences capturing the core objective and approach]
> 
> **Deliverables**: [Bullet list of concrete outputs]
> - [Output 1]
> - [Output 2]
> 
> **Estimated Effort**: [Quick | Short | Medium | Large | XL]
> **Parallel Execution**: [YES - N waves | NO - sequential]
> **Critical Path**: [Task X → Task Y → Task Z]

---

## Context

### Original Request
[User's initial description]

### Interview Summary
**Key Discussions**:
- [Point 1]: [User's decision/preference]
- [Point 2]: [Agreed approach]

**Research Findings**:
- [Finding 1]: [Implication]
- [Finding 2]: [Recommendation]

### Metis Review
**Identified Gaps** (addressed):
- [Gap 1]: [How resolved]
- [Gap 2]: [How resolved]

---

## Work Objectives

### Core Objective
[1-2 sentences: what we're achieving]

### Concrete Deliverables
- [Exact file/endpoint/feature]

### Definition of Done
- [ ] [Verifiable condition with command]

### Must Have
- [Non-negotiable requirement]

### Must NOT Have (Guardrails)
- [Explicit exclusion from Metis review]
- [AI slop pattern to avoid]
- [Scope boundary]

---

## Task Hierarchy

\`\`\`
Work Plan Structure:
├── 1. Parent Task [0/2]
│   ├── 1.1. Child Task A
│   │   └── Subtask details
│   └── 1.2. Child Task B
│       └── Subtask details
└── 2. Independent Task [0/1]
    └── 2.1. Subtask
\`\`\`

### Hierarchy Rules
- **Parent tasks**: Represent major work packages with sub-tasks
- **Child tasks**: Atomic, executable units (implementation + tests)
- **Progress tracking**: Parent shows [N/Total] where N = completed children
- **Dependencies**: Parent tasks block child execution; children don't cross-block

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> This is NOT conditional — it applies to EVERY task, regardless of test strategy.
>
> **FORBIDDEN** — acceptance criteria that require:
> - "User manually tests..." / "사용자가 직접 테스트..."
> - "User visually confirms..." / "사용자가 눈으로 확인..."
> - "User interacts with..." / "사용자가 직접 조작..."
> - "Ask user to verify..." / "사용자에게 확인 요청..."
> - ANY step where a human must perform an action
>
> **ALL verification is executed by the agent** using tools (Playwright, interactive_bash, curl, etc.). No exceptions.

### Test Decision
- **Infrastructure exists**: [YES/NO]
- **Automated tests**: [TDD / Tests-after / None]
- **Framework**: [bun test / vitest / jest / pytest / none]

### If TDD Enabled

Each TODO follows RED-GREEN-REFACTOR:

**Task Structure:**
1. **RED**: Write failing test first
   - Test file: \`[path].test.ts\`
   - Test command: \`bun test [file]\`
   - Expected: FAIL (test exists, implementation doesn't)
2. **GREEN**: Implement minimum code to pass
   - Command: \`bun test [file]\`
   - Expected: PASS
3. **REFACTOR**: Clean up while keeping green
   - Command: \`bun test [file]\`
   - Expected: PASS (still)

**Test Setup Task (if infrastructure doesn't exist):**
- [ ] 0. Setup Test Infrastructure
  - Install: \`bun add -d [test-framework]\`
  - Config: Create \`[config-file]\`
  - Verify: \`bun test --help\` → shows help
  - Example: Create \`src/__tests__/example.test.ts\`
  - Verify: \`bun test\` → 1 test passes

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

> Whether TDD is enabled or not, EVERY task MUST include Agent-Executed QA Scenarios.
> - **With TDD**: QA scenarios complement unit tests at integration/E2E level
> - **Without TDD**: QA scenarios are the PRIMARY verification method
>
> These describe how the executing agent DIRECTLY verifies the deliverable
> by running it — opening browsers, executing commands, sending API requests.
> The agent performs what a human tester would do, but automated via tools.

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| **Frontend/UI** | Playwright (playwright skill) | Navigate, interact, assert DOM, screenshot |
| **TUI/CLI** | interactive_bash (tmux) | Run command, send keystrokes, validate output |
| **API/Backend** | Bash (curl/httpie) | Send requests, parse responses, assert fields |
| **Library/Module** | Bash (bun/node REPL) | Import, call functions, compare output |
| **Config/Infra** | Bash (shell commands) | Apply config, run state checks, validate |

**Each Scenario MUST Follow This Format:**

\`\`\`
Scenario: [Descriptive name — what user action/flow is being verified]
  Tool: [Playwright / interactive_bash / Bash]
  Preconditions: [What must be true before this scenario runs]
  Steps:
    1. [Exact action with specific selector/command/endpoint]
    2. [Next action with expected intermediate state]
    3. [Assertion with exact expected value]
  Expected Result: [Concrete, observable outcome]
  Failure Indicators: [What would indicate failure]
  Evidence: [Screenshot path / output capture / response body path]
\`\`\`

**Scenario Detail Requirements:**
- **Selectors**: Specific CSS selectors (\`.login-button\`, not "the login button")
- **Data**: Concrete test data (\`"test@example.com"\`, not \`"[email]"\`)
- **Assertions**: Exact values (\`text contains "Welcome back"\`, not "verify it works")
- **Timing**: Include wait conditions where relevant (\`Wait for .dashboard (timeout: 10s)\`)
- **Negative Scenarios**: At least ONE failure/error scenario per feature
- **Evidence Paths**: Specific file paths (\`.sisyphus/evidence/task-N-scenario-name.png\`)

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput by grouping independent tasks into parallel waves.
> Each wave completes before the next begins.

\`\`\`
Wave 1 (Start Immediately):
├── Task 1: [no dependencies]
└── Task 5: [no dependencies]

Wave 2 (After Wave 1):
├── Task 2: [depends: 1]
├── Task 3: [depends: 1]
└── Task 6: [depends: 5]

Wave 3 (After Wave 2):
└── Task 4: [depends: 2, 3]

Critical Path: Task 1 → Task 2 → Task 4
Parallel Speedup: ~40% faster than sequential
\`\`\`

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 2, 3 | 5 |
| 2 | 1 | 4 | 3, 6 |
| 3 | 1 | 4 | 2, 6 |
| 4 | 2, 3 | None | None (final) |
| 5 | None | 6 | 1 |
| 6 | 5 | None | 2, 3 |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 5 | task(category="...", load_skills=[...], run_in_background=false) |
| 2 | 2, 3, 6 | dispatch parallel after Wave 1 completes |
| 3 | 4 | final integration task |

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info.
> Support hierarchical structures: parent tasks aggregate child completion.

**CRITICAL: Hierarchical Numbering Rules**

1. **If a task shows \`[0/N]\` with N > 0, it MUST have exactly N child tasks below it**
2. **Child tasks MUST use hierarchical numbering**: \`1.1\`, \`1.2\`, \`2.1\`, \`2.2.1\`, etc.
3. **Parent tasks with children ONLY contain metadata** — all implementation details go into child tasks
4. **WRONG**: \`- [ ] 2. Task [0/1]\` followed by \`**What to do**: ...\` with no \`2.1\` child
5. **CORRECT**: \`- [ ] 2. Task [0/1]\` followed by \`---\` and \`- [ ] 2.1. Subtask\` with implementation details

**Examples follow these rules strictly:**

- [ ] 1. Parent Task [0/2]

  **What to do**: [High-level work package]
  
  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: \`[visual-engineering | ultrabrain | artistry | quick | unspecified-low | unspecified-high | writing]\`
    - Reason: [Why this category fits the task domain]
  - **Skills**: [\`skill-1\`, \`skill-2\`]
    - \`skill-1\`: [Why needed - domain overlap explanation]
    - \`skill-2\`: [Why needed - domain overlap explanation]

  **Parallelization**:
  - **Can Run In Parallel**: YES | NO
  - **Parallel Group**: Wave N (with Tasks X, Y) | Sequential
  - **Blocks**: [Child tasks 1.1, 1.2]
  - **Blocked By**: None (can start immediately)

  ---

  - [ ] 1.1. Child Task A

    **What to do**:
    - [Clear implementation steps]
    - [Test cases to cover]

    **Must NOT do**:
    - [Specific exclusions from guardrails]

    **Recommended Agent Profile**:
    - **Category**: \`quick\`
      - Reason: Atomic, well-scoped implementation
    - **Skills**: [\`git-master\`]
      - \`git-master\`: [Why needed]

    **Parallelization**:
    - **Can Run In Parallel**: NO
    - **Blocked By**: Parent task 1 started
    - **Blocks**: None

    **References** (CRITICAL - Be Exhaustive):

    > The executor has NO context from your interview. References are their ONLY guide.
    > Each reference must answer: "What should I look at and WHY?"

    **Pattern References** (existing code to follow):
    - \`src/services/auth.ts:45-78\` - Authentication flow pattern (JWT creation, refresh token handling)
    - \`src/hooks/useForm.ts:12-34\` - Form validation pattern (Zod schema + react-hook-form integration)

    **Acceptance Criteria**:

    > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.
    > Every criterion MUST be verifiable by running a command or using a tool.

    **If TDD (tests enabled):**
    - [ ] Test file created: src/auth/login.test.ts
    - [ ] Test covers: successful login returns JWT token
    - [ ] bun test src/auth/login.test.ts → PASS (3 tests, 0 failures)

    **Agent-Executed QA Scenarios (MANDATORY):**

    \\\`\\\`\\\`
    Scenario: Successful operation
      Tool: Bash
      Preconditions: [Setup state]
      Steps:
        1. [Run command or interact]
        2. [Verify intermediate state]
        3. [Assert final outcome]
      Expected Result: [Observable outcome]
      Evidence: [Evidence path]
    \\\`\\\`\\\`

    **Evidence to Capture:**
    - [ ] Screenshots in .sisyphus/evidence/ for UI scenarios
    - [ ] Terminal output for CLI/TUI scenarios
    - [ ] Response bodies for API scenarios

    **Commit**: YES | NO (groups with N)
    - Message: \`type(scope): desc\`
    - Files: \`path/to/file\`
    - Pre-commit: \`test command\`

  ---

  - [ ] 1.2. Child Task B

    **What to do**:
    - [Clear implementation steps]
    - [Test cases to cover]

    **Recommended Agent Profile**:
    - **Category**: \`quick\`
    - **Skills**: [\`skill-name\`]

    **Parallelization**:
    - **Can Run In Parallel**: NO
    - **Blocked By**: Child task 1.1
    - **Blocks**: None

    **References**:
    - [Similar to 1.1]

    **Acceptance Criteria**:
    - [ ] [Criterion with verification command]

    **Commit**: YES | NO

---

- [ ] 2. Independent Task [0/1]

  **What to do**: [Standalone work]

  **Recommended Agent Profile**:
  - **Category**: \`quick\`
  - **Skills**: [\`git-master\`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1

  ---

  - [ ] 2.1. Subtask

    **What to do**: [Implementation details]

    **Acceptance Criteria**:
    - [ ] [Verifiable criterion]

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | \`type(scope): desc\` | file.ts | npm test |

---

## Success Criteria

### Verification Commands
\`\`\`bash
command  # Expected: output
\`\`\`

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Hierarchical structure valid (parents = sum of children)

---
`
