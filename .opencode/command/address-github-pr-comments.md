---
description: Process PR reviewer feedback, apply fixes, and draft responses.
---

# Address GitHub PR Comments

## Overview

Process outstanding reviewer feedback on a GitHub pull request, apply required fixes, and draft clear responses for each comment.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Sync and audit comments**
   - Pull the latest branch changes
   - Open the PR conversation view and read every unresolved comment
   - Group comments by affected files or themes
   - Identify comment types: required changes, questions, suggestions

2. **Plan resolutions**
   - List the requested code edits for each thread
   - Identify clarifications or additional context you must provide
   - Note any dependencies or blockers before implementing changes
   - Prioritize by severity (blocking vs. nice-to-have)

3. **Implement fixes**
   - Apply targeted updates addressing one comment thread at a time
   - Run relevant tests or linters after impactful changes
   - Stage changes with commits that reference the addressed feedback
   - Use commit messages like: `fix: address PR feedback - {description}`

4. **Draft responses**
   - Summarize the action taken or reasoning provided for each comment
   - Link to commits or lines when clarification helps reviewers verify
   - Highlight any remaining questions or follow-up needs
   - Be professional and constructive in responses

5. **Update PR status**
   - Push changes to the PR branch
   - Mark resolved comments as resolved
   - Request re-review if needed

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for PR feedback work
   - Include: comments addressed, changes made

## Response Checklist

- [ ] All reviewer comments acknowledged
- [ ] Required code changes implemented and tested
- [ ] Clarifying explanations prepared for nuanced threads
- [ ] Follow-up items documented or escalated
- [ ] PR status updated for reviewers
- [ ] Changes pushed to branch

## References

- Historian: `.opencode/agent/historian.md`
- Code Reviewer: `.opencode/agent/code-reviewer.md`
