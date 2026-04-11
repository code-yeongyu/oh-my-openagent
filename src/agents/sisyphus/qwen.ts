/**
 * Injected into base Sisyphus prompt for Qwen models.
 * Follows the same injection pattern as src/agents/sisyphus/gemini.ts.
 * Does NOT replace the base prompt — only patches what differs.
 */

export function buildQwenToolCallEnforcement(): string {
  return `<qwen_tool_enforcement>
## Tool Call Format (Qwen)

Use the exact JSON tool call schema — do not approximate tool names or parameters.
apply_patch is unreliable on some Qwen deployments. Prefer edit and write for file changes.
When calling multiple tools in one turn, list independent calls simultaneously.
</qwen_tool_enforcement>`;
}

export function buildQwenDelegationReinforcement(): string {
  return `<qwen_delegation_reminder>
## Delegation First

Before writing any code yourself:
1. Is there a subagent category that fits? → task(category="...")
2. Is this exploration? → task(subagent_type="explore", run_in_background=true)
3. Only if genuinely trivial (single file, single known edit) → act directly.
</qwen_delegation_reminder>`;
}