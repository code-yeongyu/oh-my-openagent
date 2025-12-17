---
description: Full review of pending changes in the current branch with detailed analysis.
---

# Deep Review Project

## Overview

Do a full review of pending changes in the current branch. Create an extensive and highly detailed plan and list of to-do tasks using first-principles thinking and chain-of-thought reasoning.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Gather branch context**
   - Identify current branch
   - Get list of changed files
   - Review commit history
   - Understand scope of changes

2. **Analyze changes**
   - Review each changed file
   - Understand the purpose of changes
   - Identify patterns and themes
   - Note any concerns or questions

3. **Apply first-principles thinking**
   - Break down changes to fundamental components
   - Question assumptions in the code
   - Evaluate design decisions

4. **Chain-of-thought analysis**
   - Think through implications of each change
   - Consider edge cases
   - Evaluate for correctness and completeness

5. **Create detailed task list**
   - Single-purpose tasks for any issues found
   - Prioritize by impact and risk
   - Include validation steps

6. **Generate comprehensive report**
   - Summary of changes
   - Issues identified
   - Recommendations
   - Action items

7. **Call Code Reviewer** (for thorough review):
   - Read `.opencode/agent/code-reviewer.md`
   - Apply technical review methodology
   - Evaluate cross-rule compliance

8. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for review work
   - Include: files reviewed, issues found, recommendations

## Review Checklist

- [ ] All changed files reviewed
- [ ] Commit history analyzed
- [ ] Issues identified and documented
- [ ] Recommendations provided
- [ ] Action items created
- [ ] Report generated

## References

- Code Reviewer: `.opencode/agent/code-reviewer.md`
- Historian: `.opencode/agent/historian.md`
