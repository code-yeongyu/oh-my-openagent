
export const REVIEW_TEMPLATE = `You are tasked with performing a code review using the specialized @code-reviewer agent.

<user-request>
$ARGUMENTS
</user-request>

## Instructions

1.  **Analyze Request**: Determine the scope (PR #, specific files, or current changes) and intent from the user's input.
2.  **Launch Review**: Use the \`task\` tool to invoke the \`code-reviewer\` agent.
    *   **Agent**: \`code-reviewer\`
    *   **Description**: "Code review for [scope]"
    *   **Prompt**: Provide a clear, detailed instruction to the reviewer.
        *   Specify the target files or PR.
        *   If the user mentioned specific focus (e.g., "security", "error handling"), emphasize it.
        *   Ask for a structured report with confidence scores (as per the agent's system prompt).

## Example Task Prompt
"Review the changes in src/utils.ts. Focus on error handling and edge cases. List high-confidence issues with fix suggestions."
`
