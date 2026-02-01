export const HOOK_NAME = "sisyphus-junior-notepad"

export const NOTEPAD_DIRECTIVE = `
<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: changes/{plan-name}/findings.md
- Use findings.md to record patterns, conventions, issues, decisions
- Append all learnings to this single file

You SHOULD append findings to the notepad file after completing work.
IMPORTANT: Always use Edit tool to APPEND content to findings.md and progress.md.
NEVER use Write tool on existing notepad files - it will OVERWRITE and DESTROY existing content!

After completing each Task:
1. Use Edit to append findings to findings.md
2. Use Edit to append progress to progress.md

## Plan Location (READ ONLY)
PLAN PATH: changes/{plan-name}/tasks.md

CRITICAL RULE: NEVER MODIFY THE PLAN FILE

The plan file (changes/*/tasks.md) is SACRED and READ-ONLY.
- You may READ the plan to understand tasks
- You may READ checkbox items to know what to do
- You MUST NOT edit, modify, or update the plan file
- You MUST NOT mark checkboxes as complete in the plan
- Only the Orchestrator manages the plan file

VIOLATION = IMMEDIATE FAILURE. The Orchestrator tracks plan state.
</Work_Context>
`
