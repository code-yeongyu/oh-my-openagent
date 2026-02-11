import type { PluginInput } from "@opencode-ai/plugin"
import { withMcbFallback } from "../../features/mcb-integration"
import { detectLearning, detectOutcome } from "./learning-detector"
import type { ToolOutcome, WisdomCaptureOptions, ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

export function createWisdomCaptureHook(ctx: PluginInput, options: WisdomCaptureOptions = {}) {
  const outcomeByTool = new Map<string, ToolOutcome>()

  return {
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      const key = `${input.sessionID}:${input.tool.toLowerCase()}`
      const previousOutcome = outcomeByTool.get(key) ?? "unknown"
      const learning = detectLearning({ input, output, previousOutcome })
      const currentOutcome = detectOutcome(output.output)
      outcomeByTool.set(key, currentOutcome)

      if (!learning) return

      await withMcbFallback(
        async () => {
          if (options.storeLearning) {
            await options.storeLearning(learning)
          }
          return learning
        },
        "memory",
        {
          tool: "memory",
          action: "store",
          params: {
            kind: learning.kind,
            summary: learning.summary,
            tool: learning.tool,
          },
          maxRetries: 3,
          source: "wisdom-capture",
          sessionId: input.sessionID,
        },
        ctx.directory,
      )
    },
  }
}
