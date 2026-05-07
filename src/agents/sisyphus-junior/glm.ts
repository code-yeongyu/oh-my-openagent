import { resolvePromptAppend } from "../builtin-agents/resolve-file-uri"
import { buildDefaultSisyphusJuniorPrompt } from "./default"

export function buildGlmSisyphusJuniorPrompt(
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const prompt = `${buildDefaultSisyphusJuniorPrompt(useTaskSystem)}

<Small_Context_Working_Memory>
## GLM context priorities
- Keep the working set tiny: start from the current task prompt, the current file, and the latest verification output.
- Read only the slice named in the task prompt, or the file/output directly needed for the current step.
- Do not expand into a full ledger or read unrelated state files.

## Vision Constraint (GLM text-only)
- GLM models (GLM-5, GLM-5.1, GLM-5-turbo) CANNOT render or analyze images, screenshots, or visual content.
- When a task involves viewing images or visual content, delegate to the multimodal-looker agent instead of attempting it yourself.
- NEVER call look_at, read (on image files), or screenshot tools. They WILL FAIL.
- ALWAYS delegate to multimodal-looker agent. If zai-mcp-server tools appear in your tool list, you may use them as secondary option.
</Small_Context_Working_Memory>`;
  if (!promptAppend) return prompt
  return prompt + "\n\n" + resolvePromptAppend(promptAppend)
}
