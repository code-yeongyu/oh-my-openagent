import type { PluginInput } from "@opencode-ai/plugin"

export const EDIT_ERROR_PATTERNS = [
  "oldString and newString must be different",
  "oldString not found",
  "oldString found multiple times",
] as const

export const EDIT_ERROR_REMINDER = `
[EDIT ERROR - IMMEDIATE ACTION REQUIRED]

You made an Edit mistake. STOP and do this NOW:

1. READ the file immediately to see its ACTUAL current state
2. VERIFY what the content really looks like (your assumption was wrong)
3. APOLOGIZE briefly to the user for the error
4. CONTINUE with corrected action based on the real file content

DO NOT attempt another edit until you've read and verified the file state.
`

export function createEditErrorRecoveryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "edit") return

      const outputLower = output.output.toLowerCase()
      const hasEditError = EDIT_ERROR_PATTERNS.some((pattern) =>
        outputLower.includes(pattern.toLowerCase())
      )

      if (hasEditError) {
        output.output += `\n${EDIT_ERROR_REMINDER}`
      }
    },
  }
}
