export function getDevinAutoDelegateMessage(taskDescription: string): string {
  return `## [AUTO-DELEGATE] Simple Task Detected

This user request appears to be a **simple task** best handled by the Devin CLI with a fast, cost-effective model.

**Task**: ${taskDescription}

**Action**: Automatically delegate this to Devin using \`devin_start\` with model \`"swe-1-6"\` (or omit model to use default).

**Why**: This is a straightforward task — a single file edit, file listing, README update, or simple script. Devin can handle it quickly and cheaply while you remain available for more complex work.

**Rules**:
- Compose a self-contained prompt with all necessary context
- Use \`permission_mode: "auto"\`
- Do NOT wait for completion unless the user explicitly asked you to
- Report the session ID and move on
- If Devin fails, fall back to handling it yourself

Proceed with delegation.`
}
