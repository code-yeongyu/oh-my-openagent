import type { PluginInput } from "@opencode-ai/plugin"

/**
 * System reminder injected when a tool call fails due to JSON parse error.
 * Forces the agent to stop and correct its output format.
 */
export const JSON_ERROR_REMINDER = `
[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]

You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:

1. LOOK at the error message above to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).
3. RETRY the tool call with valid JSON.

DO NOT repeat the exact same invalid call.
`

/**
 * Detects JSON parse errors in tool outputs and injects a recovery reminder.
 * 
 * Catches errors like:
 * - JSON Parse error: Expected '}'
 * - JSON Parse error: Unexpected EOF
 * - SyntaxError: Unexpected token
 */
export function createJsonErrorRecoveryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      // Check for common JSON error patterns in the output
      const outputLower = output.output.toLowerCase()
      const isJsonError = 
        outputLower.includes("json parse error") || 
        outputLower.includes("syntaxerror: unexpected token") ||
        outputLower.includes("expected '}'") ||
        outputLower.includes("unexpected eof")

      if (isJsonError) {
        output.output += `\n${JSON_ERROR_REMINDER}`
      }
    },
  }
}
