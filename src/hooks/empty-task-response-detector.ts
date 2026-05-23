import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"
import { extractTaskLink } from "../features/tool-metadata-store"

const EMPTY_RESPONSE_WARNING = `[Task Empty Response Warning]

Task invocation completed but returned no response. This indicates the agent either:
- Failed to execute properly
- Did not terminate correctly
- Returned an empty result

Note: The call has already completed - you are NOT waiting for a response. Proceed accordingly.`

export function createEmptyTaskResponseDetectorHook(
  _ctx: PluginInput,
  backgroundManager?: BackgroundManager,
) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return

      const responseText = output.output?.trim() ?? ""

      if (responseText !== "") return

      if (backgroundManager) {
        const link = extractTaskLink(output.metadata, "")
        const sessionId = link.sessionId

        if (sessionId) {
          const didFallback = await backgroundManager.retryTaskOnEmptyOutput(sessionId)
          if (didFallback) return
        }
      }

      output.output = EMPTY_RESPONSE_WARNING
    },
  }
}
