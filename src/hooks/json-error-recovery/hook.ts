import type { PluginInput } from "@opencode-ai/plugin"

export const JSON_ERROR_PATTERNS = [
  "json parse error",
  "syntaxerror: unexpected token",
  "expected '}'",
  "unexpected eof",
] as const

export const JSON_ERROR_REMINDER = `
[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]

You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:

1. LOOK at the error message above to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).
3. RETRY the tool call with valid JSON.

DO NOT repeat the exact same invalid call.
`

export function createJsonErrorRecoveryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      _input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (typeof output.output !== "string") return

      const outputLower = output.output.toLowerCase()
      const hasJsonError = JSON_ERROR_PATTERNS.some((pattern) =>
        outputLower.includes(pattern)
      )

      if (hasJsonError) {
        output.output += `\n${JSON_ERROR_REMINDER}`
      }
    },
  }
}
