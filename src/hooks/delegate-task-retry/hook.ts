import type { PluginInput } from "@opencode-ai/plugin"

import { buildRetryGuidance } from "./guidance"
import { detectDelegateTaskError } from "./patterns"
import { appendToOutput } from "../hook-output-guard"

export function createDelegateTaskRetryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "task") return

      const errorInfo = detectDelegateTaskError(output.output ?? "")
      if (errorInfo) {
        const guidance = buildRetryGuidance(errorInfo)
        appendToOutput(output, `\n${guidance}`)
      }
    },
  }
}
