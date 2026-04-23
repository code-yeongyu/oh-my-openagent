import type { BuiltinSkill } from "../types"

export const REVIEW_WORK_SKILL_NAME = "review-work"

export const REVIEW_WORK_SKILL_DESCRIPTION =
  "Post-implementation review orchestrator. Launches 5 parallel background sub-agents: Oracle (goal/constraint verification), Oracle (code quality), Oracle (security), unspecified-high (hands-on QA execution), unspecified-high (context mining from GitHub/git/Slack/Notion). All must pass for review to pass. MUST USE after completing any significant implementation work. Triggers: 'review work', 'review my work', 'review changes', 'QA my work', 'verify implementation', 'check my work', 'validate changes', 'post-implementation review'."

export const reviewWorkSkill: BuiltinSkill = {
  name: REVIEW_WORK_SKILL_NAME,
  description: REVIEW_WORK_SKILL_DESCRIPTION,
  template: `# Review Work - 5-Agent Parallel Review Orchestrator

Launch 5 specialized sub-agents in parallel to review completed implementation work from every angle. All 5 must pass for the review to pass. If even ONE fails, the review fails.

The 5 agents cover complementary concerns - together they form a comprehensive review that no single reviewer could match:

| # | Agent | Type | Role | Focus Level |
|---|-------|------|------|-------------|
| 1 | Goal Verifier | Oracle | Did we build what was asked? | MAIN |
| 2 | QA Executor | unspecified-high | Does it actually work? | MAIN |
| 3 | Code Reviewer | Oracle | Is the code well-written? | MAIN |
| 4 | Security Auditor | Oracle | Is it secure? | SUB |
| 5 | Context Miner | unspecified-high | Did we miss any context? | MAIN |

---

## Phase 0: Gather Review Context

Before launching agents, collect these inputs. Extract from conversation history first - the user's original request, constraints discussed, and decisions made are usually already in the thread. Only ask if truly missing.

<required_inputs>

- **GOAL**: The original objective. What was the user trying to achieve? Pull from the initial request in this conversation.
- **CONSTRAINTS**: Rules, requirements, or limitations. Tech stack restrictions, performance targets, API contracts, design patterns to follow, backward compatibility needs.
- **BACKGROUND**: Why this work was needed. Business context, user stories, related systems, prior decisions that informed the approach.
- **CHANGED_FILES**: Auto-collect via \`git diff --name-only HEAD~1\` or against the appropriate base (branch point, specific commit).
- **DIFF**: Auto-collect via \`git diff HEAD~1\` or against the appropriate base.
- **FILE_CONTENTS**: Read the full content of each changed file (not just the diff). Oracle agents cannot read files - they need full context in the prompt.
- **RUN_COMMAND**: How to start/run the application. Check \`package.json\` scripts, \`Makefile\`, \`docker-compose.yml\`, or ask the user.

</required_inputs>

**NEVER CHECKOUT A PR BRANCH IN THE MAIN WORKTREE. ALWAYS CREATE A NEW GIT WORKTREE (\`git worktree add\`) AND WORK THERE. THIS PREVENTS CONTAMINATING THE USER'S WORKING DIRECTORY WITH UNRELATED BRANCH STATE.**

**Auto-collection sequence:**

\`\`\`bash
# 1. Get changed files
git diff --name-only HEAD~1  # or: git diff --name-only main...HEAD

# 2. Get diff
git diff HEAD~1  # or: git diff main...HEAD

# 3. Detect run command
# Check package.json -> "scripts.dev" or "scripts.start"
# Check Makefile -> default target
# Check docker-compose.yml -> services
\`\`\`

For GOAL, CONSTRAINTS, BACKGROUND - review the full conversation history. The user's original message almost always contains the goal. Constraints often emerge during discussion. If anything critical is ambiguous, ask ONE focused question - not a checklist.

---

## Phase 1: Launch 5 Agents

Launch ALL 5 in a single turn. Every agent uses \`run_in_background=true\`. No sequential launches. No waiting between them.

**Oracle agents receive everything in the prompt** (they cannot read files or run commands). Include DIFF + FILE_CONTENTS + all context directly in the prompt text.

**unspecified-high agents are autonomous** - they can read files, run commands, and use tools. Give them goals and pointers, not raw content dumps.

---

### Agent 1: Goal & Constraint Verification (Oracle) - MAIN

\`\`\`
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Verify implementation against original goal and constraints",
  prompt="""
<review_type>GOAL & CONSTRAINT VERIFICATION</review_type>

<original_goal>
{GOAL - paste the user's original request and any clarifications}
</original_goal>

<constraints>
{CONSTRAINTS - every rule, requirement, or limitation discussed}
</constraints>

<background>
{BACKGROUND - why this work was needed, broader context}
</background>

<changed_files>
{CHANGED_FILES - list of modified file paths}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of every changed file, clearly delimited per file}
</file_contents>

<diff>
{DIFF - the actual git diff}
</diff>

Review whether this implementation correctly and completely achieves the stated goal within the given constraints.

REVIEW CHECKLIST:
1. **Goal Completeness**: Break the goal into every sub-requirement. Mark ACHIEVED / MISSED / PARTIAL.
2. **Constraint Compliance**: List every constraint. Verify compliance with specific code evidence.
3. **Requirement Gaps**: Requirements implied by the goal that a thoughtful engineer would have included.
4. **Over-Engineering**: Anything added that wasn't requested.
5. **Edge Cases**: What inputs or scenarios would break this? Trace through at least 5.
6. **Behavioral Correctness**: Walk through the code logic for 3+ representative scenarios.

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<goal_breakdown>
  - [ACHIEVED/MISSED/PARTIAL] Requirement - Evidence
</goal_breakdown>
<constraint_compliance>
  - [ACHIEVED/MISSED] Constraint - evidence
</constraint_compliance>
<findings>
  - [PASS/FAIL/WARN] Category: Description - File: path
</findings>
<blocking_issues>Issues that MUST be fixed. Empty if PASS.</blocking_issues>
""")
\`\`\`

---

### Agent 2: QA via App Execution (unspecified-high) - MAIN

\`\`\`
task(
  category="unspecified-high",
  run_in_background=true,
  load_skills=["playwright", "dev-browser"],
  description="QA by actually running and using the application",
  prompt="""
<review_type>QA - HANDS-ON APP EXECUTION</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<run_command>
{RUN_COMMAND - how to start the application, or "unknown" if not determined}
</run_command>

You are a QA engineer. RUN the application and verify it works through hands-on testing.

MANDATORY PROCESS:

1. **Scenario Brainstorm**: Write EVERY test scenario - happy paths, boundary conditions, error paths, regression scenarios, state transitions, integration points. Aim for 15-30 scenarios.
2. **Augmentation**: Add 5+ more scenarios from reflection. Group by priority: P0 (must pass), P1 (should pass), P2 (nice to pass).
3. **Create Task List**: Convert to structured tasks with steps, expected result, priority.
4. **Execute Systematically**: P0 first. For each test: execute, record actual result, mark PASS/FAIL, capture evidence on failure.
5. **Compile Results**.

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<scenario_coverage>P0: X/Y passed, P1: X/Y passed, P2: X/Y passed</scenario_coverage>
<test_results>- [PASS/FAIL] Test name (Priority) - Steps / Expected / Actual / Evidence</test_results>
<blocking_issues>P0 or P1 failures only. Empty if PASS.</blocking_issues>
""")
\`\`\`

---

### Agent 3: Code Quality Review (Oracle) - MAIN

\`\`\`
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Review overall code quality, patterns, and architecture",
  prompt="""
<review_type>CODE QUALITY REVIEW</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files AND neighboring files that show existing patterns}
</file_contents>

<diff>
{DIFF}
</diff>

<background>
{BACKGROUND}
</background>

Senior staff engineer conducting a code review. Standard: "Would I approve this PR without comments?"

REVIEW DIMENSIONS:
1. **Correctness**: Logic errors, null/undefined handling, race conditions, resource leaks.
2. **Pattern Consistency**: Does new code follow the codebase's established patterns?
3. **Naming & Readability**: Clear names? Self-documenting code?
4. **Error Handling**: Errors properly caught, logged, propagated? No empty catch blocks?
5. **Type Safety**: Any \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`? Correct type narrowing?
6. **Performance**: N+1 queries? Blocking I/O on hot paths? Memory leaks?
7. **Abstraction Level**: Right level? No duplication? No premature over-abstraction?
8. **Testing**: New behaviors covered? Tests are meaningful?
9. **API Design**: Public interfaces clean and consistent?
10. **Tech Debt**: New tech debt introduced?

Severity: CRITICAL (production bugs) / MAJOR (fix before merge) / MINOR (improvement) / NITPICK (style)

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<findings>- [CRITICAL/MAJOR/MINOR/NITPICK] Category: Description - File: path - Current / Suggestion</findings>
<blocking_issues>CRITICAL and MAJOR items only. Empty if PASS.</blocking_issues>
""")
\`\`\`

---

### Agent 4: Security Review (Oracle) - SUB

\`\`\`
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Security-focused review of implementation changes",
  prompt="""
<review_type>SECURITY REVIEW (supplementary)</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files}
</file_contents>

<diff>
{DIFF}
</diff>

Security engineer. Review exclusively for security vulnerabilities. Ignore code style unless it directly creates a security risk.

SECURITY CHECKLIST:
1. Input Validation: User inputs sanitized? SQL injection, XSS, command injection, SSRF?
2. Auth & AuthZ: Authentication checks where needed? Privilege escalation paths?
3. Secrets & Credentials: Hardcoded secrets, API keys, tokens in code or logs?
4. Data Exposure: Sensitive data in logs? PII in error messages?
5. Dependencies: New dependencies? Known CVEs?
6. Cryptography: Proper algorithms? No custom crypto? Secure random?
7. File & Path: Path traversal? Unsafe file operations?
8. Network: CORS correct? Rate limiting? TLS enforced?
9. Error Leakage: Stack traces exposed to users?
10. Supply Chain: Lockfile updated?

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<severity>CRITICAL / HIGH / MEDIUM / LOW / NONE</severity>
<summary>1-3 sentence overall assessment</summary>
<findings>- [CRITICAL/HIGH/MEDIUM/LOW] Category: Description - File: path - Risk / Remediation</findings>
<blocking_issues>CRITICAL and HIGH items only. Empty if PASS.</blocking_issues>
""")
\`\`\`

---

### Agent 5: Context Mining (unspecified-high) - MAIN

\`\`\`
task(
  category="unspecified-high",
  run_in_background=true,
  load_skills=["git-master"],
  description="Mine all accessible contexts for missed requirements or background knowledge",
  prompt="""
<review_type>CONTEXT MINING - MISSED REQUIREMENTS & BACKGROUND</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<background>
{BACKGROUND}
</background>

Investigator mission: search every accessible information source to find context that should have informed this implementation but might have been missed.

SOURCES TO SEARCH:

1. **Git History**:
   - \`git log --oneline -20 -- {each changed file}\`
   - \`git blame {critical sections}\`
   - \`git log --all --grep="{keywords from goal}"\`
   - Look for reverted commits, TODO/FIXME/HACK comments in history

2. **GitHub** (if \`gh\` CLI available):
   - \`gh issue list --search "{keywords}"\`
   - \`gh pr list --search "{keywords}" --state all\`
   - Check related issues and PR review comments

3. **Codebase Cross-References**:
   - Files that import or reference the changed modules
   - Tests that might need updating due to behavior changes
   - Documentation that references changed behavior
   - Config files that might need corresponding updates

WHAT TO LOOK FOR:
- Requirements mentioned in issues/PRs that the implementation misses
- Past decisions explaining WHY code was written a certain way
- Related systems or features affected by these changes
- Warnings from previous developers (PR review comments, inline TODOs)
- Migration or deprecation notes that affect the changed code

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<sources_searched>- [SEARCHED/SKIPPED] Source name - what was searched</sources_searched>
<discovered_context>- Source / Finding / Relevance / Impact: [BLOCKING/IMPORTANT/FYI]</discovered_context>
<missed_requirements>Requirements the implementation should address but doesn't. Empty if none.</missed_requirements>
<blocking_issues>BLOCKING items only. Empty if PASS.</blocking_issues>
""")
\`\`\`

---

## Phase 2: Wait & Collect

After launching all 5 agents in one turn, **end your response**. Wait for system notifications as each agent completes.

Collect via \`background_output(task_id="...")\` as each completes. Track verdicts:

| Agent | Verdict | Notes |
|-------|---------|-------|
| 1. Goal Verification | pending | - |
| 2. QA Execution | pending | - |
| 3. Code Quality | pending | - |
| 4. Security | pending | - |
| 5. Context Mining | pending | - |

Do NOT deliver the final report until ALL 5 have completed.

---

## Phase 3: Deliver Verdict

ALL 5 returned PASS → **REVIEW PASSED**
ANY returned FAIL → **REVIEW FAILED**

Final report format:

\`\`\`markdown
# Review Work - Final Report

## Overall Verdict: PASSED / FAILED

| # | Review Area | Agent Type | Verdict | Confidence |
|---|------------|------------|---------|------------|
| 1 | Goal & Constraint Verification | Oracle | PASS/FAIL | HIGH/MED/LOW |
| 2 | QA Execution | unspecified-high | PASS/FAIL | HIGH/MED/LOW |
| 3 | Code Quality | Oracle | PASS/FAIL | HIGH/MED/LOW |
| 4 | Security (supplementary) | Oracle | PASS/FAIL | Severity |
| 5 | Context Mining | unspecified-high | PASS/FAIL | HIGH/MED/LOW |

## Blocking Issues
[Aggregated from all agents - deduplicated, prioritized]

## Key Findings
[Top 5-10 most important findings, grouped by theme]

## Recommendations
[If FAILED: exactly what to fix, in priority order]
[If PASSED: non-blocking suggestions worth considering]
\`\`\`
`,
}
