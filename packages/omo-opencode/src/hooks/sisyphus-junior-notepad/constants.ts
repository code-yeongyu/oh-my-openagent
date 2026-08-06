export const HOOK_NAME = "sisyphus-junior-notepad"

export const NOTEPAD_DIRECTIVE = `
<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: .omo/notepads/{plan-name}/
- learnings.md: Record patterns, conventions, successful approaches
- issues.md: Record problems, blockers, gotchas encountered
- decisions.md: Record architectural choices and rationales
- problems.md: Record unresolved issues, technical debt

You SHOULD append findings to notepad files after completing work.
Notepad files are auto-scaffolded by /start-work. APPEND only - use the \`edit\` tool (match-and-insert after the last line) or \`bash\` \`>>\`. Never use the \`write\` tool (blocked by notepad-write-guard) and never overwrite.

## Plan Location (subagent: READ ONLY)
PLAN PATH: .omo/plans/{plan-name}.md

SUBAGENT PLAN RESTRICTION (applies to YOU, the delegated worker — NOT to the Orchestrator):
- You may READ the plan to understand your assigned tasks
- You may READ checkbox items to know what to work on
- You MUST NOT edit the plan file or mark checkboxes — that is the Orchestrator's job
- The Orchestrator (Atlas) updates checkboxes after verifying your completed work
</Work_Context>
`
