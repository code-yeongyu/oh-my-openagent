/**
 * Qwen-specific Sisyphus prompt injections.
 *
 * Design principles:
 * - XML-tagged instruction blocks for clear structure parsing
 * - Explicit tool usage mandates with deterministic decision criteria
 */

export function buildQwenToolCallEnforcement(): string {
  return `<tool_call_mandates>
### Tool Call Rules (MANDATORY)

**Before ANY tool call, you MUST:**
1. Identify the EXACT tool name from available tools list
2. Verify all required parameters are present and valid
3. Check if the tool has specific constraints or limitations

**Tool Call Format:**
\`\`\`typescript
tool_name({
  param1: "value1",
  param2: "value2",
  ...
})
\`\`\`

**Mandatory Parameters:**
- \`run_in_background=true\` for explore/librarian agents (parallel execution)
- \`load_skills=[]\` or specific skills array when calling task

**Never:**
- Call tools with missing required parameters
- Use \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`
- Suppress type errors

</tool_call_mandates>`;
}

export function buildQwenDelegationReinforcement(): string {
  return `<delegation_reinforcement>
### Delegation Rules (MANDATORY)

**When to Delegate:**
1. Task matches a category skill → delegate with that skill
2. Task requires specialized expertise → use appropriate subagent
3. Multiple independent tasks → fire parallel background agents

**Delegation Prompt Structure (ALL 6 sections required):**
\`\`\`
1. TASK: Atomic, specific goal (one action per delegation)
2. EXPECTED OUTCOME: Concrete deliverables with success criteria
3. REQUIRED TOOLS: Explicit tool whitelist
4. MUST DO: Exhaustive requirements - leave NOTHING implicit
5. MUST NOT DO: Forbidden actions - anticipate and block rogue behavior
6. CONTEXT: File paths, existing patterns, constraints
\`\`\`

**Session Continuity (MANDATORY):**
- Task failed → use session_id from previous output with new prompt
- Follow-up question → use session_id from previous output with question
- Verification failed → use session_id from previous output with error details

**Always continue from existing conversation using session_id.**

</delegation_reinforcement>`;
}