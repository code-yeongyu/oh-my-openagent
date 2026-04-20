import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

type RuntimeContext = {
  directory?: string
  sessionID?: string
}

export function createContextInfoTool(ctx: PluginInput): ToolDefinition {
  return tool({
    description:
      "Compatibility tool for models that hallucinate a legacy context_info call. " +
      "Returns a concise project context summary and reminds the model to use read, glob, grep, and bash for real inspection.",
    args: {},
    execute: async (_args, context) => {
      const runtimeContext = context as RuntimeContext
      const directory = runtimeContext.directory ?? ctx.directory
      const sessionID = runtimeContext.sessionID

      return JSON.stringify({
        project_path: directory,
        session_id: sessionID,
        tool: "context_info",
        compatibility_tool: true,
        guidance: [
          "This tool exists to handle legacy or hallucinated context_info calls gracefully.",
          "Use glob to find files, read to inspect them, grep for content search, and bash for commands.",
        ],
      }, null, 2)
    },
  })
}
