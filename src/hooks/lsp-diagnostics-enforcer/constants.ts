/**
 * LSP Diagnostics Enforcer Hook Constants
 *
 * Forces lsp_diagnostics to be run before tasks can be marked as completed.
 * Implements Task 6.1 from SUBAGENTS-COMPARISON.md
 */

export const HOOK_NAME = "lsp-diagnostics-enforcer"

export const REMINDER_MESSAGE = `⚠️ **LSP Diagnostics Required**

Before marking this task as complete, you MUST run \`lsp_diagnostics\` at the PROJECT level:

\`\`\`typescript
lsp_diagnostics({ filePath: "src/" })  // or "." for entire project
\`\`\`

**Why this is mandatory:**
- File-level checks miss cascading type errors
- Ensures no broken imports or type mismatches
- Catches issues that single-file edits can cause

**Only mark complete when lsp_diagnostics returns ZERO errors.**`

export const TOOLS_REQUIRING_DIAGNOSTICS = [
  "Edit",
  "Write",
  "MultiEdit",
] as const

export const DIAGNOSTICS_TOOL = "lsp_diagnostics"
