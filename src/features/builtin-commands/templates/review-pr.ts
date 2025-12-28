
export const REVIEW_PR_TEMPLATE = `# PR Review Toolkit

You will orchestrate a comprehensive code review using the specialized \`code-reviewer\` agent.
Perform the following reviews in parallel or sequence as appropriate.

## 1. Safety Review (Silent Failure Hunter)
Target: Error handling, catch blocks, fallbacks.
**Instruction**:
\`Ask @code-reviewer to adopt the 'silent_failure_hunter' persona. Review the codebase/PR for silent failures, empty catch blocks, and poor error reporting.\`

## 2. Type Design Analysis
Target: New types, interfaces, data models.
**Instruction**:
\`Ask @code-reviewer to adopt the 'type_design_analyzer' persona. Analyze the new types for encapsulation, invariant strength, and expressiveness.\`

## 3. Test Coverage Analysis
Target: Tests and critical paths.
**Instruction**:
\`Ask @code-reviewer to adopt the 'pr_test_analyzer' persona. Analyze the test coverage for critical gaps and quality issues.\`

## 4. General Review
Target: Bugs, Style, Security.
**Instruction**:
\`Ask @code-reviewer (default mode) to review for logical bugs and project convention violations.\`

---

**Report Findings**:
Summarize the findings from all agents into a prioritized list of action items.
`
