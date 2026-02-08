import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { ALLOWED_AGENTS, CALL_OMO_AGENT_DESCRIPTION } from "./constants"
import type { CallOmoAgentArgs } from "./types"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared"
import { normalizeAgentType } from "./agent-type-normalizer"
import { executeBackgroundAgent } from "./background-agent-executor"
import { executeSyncAgent } from "./sync-agent-executor"
import type { ToolContextWithMetadata } from "./tool-context-with-metadata"

export function createCallOmoAgent(
  ctx: PluginInput,
  backgroundManager: BackgroundManager
): ToolDefinition {
  const agentDescriptions = ALLOWED_AGENTS.map(
    (name) => `- ${name}: Specialized agent for ${name} tasks`
  ).join("\n")
  const description = CALL_OMO_AGENT_DESCRIPTION.replace("{agents}", agentDescriptions)

  return tool({
    description,
    args: {
      description: tool.schema.string().describe("A short (3-5 words) description of the task"),
      prompt: tool.schema.string().describe("The task for the agent to perform"),
      subagent_type: tool.schema
        .string()
        .describe("The type of specialized agent to use for this task (explore or librarian only)"),
      run_in_background: tool.schema
        .boolean()
        .describe("REQUIRED. true: run asynchronously (use background_output to get results), false: run synchronously and wait for completion"),
      session_id: tool.schema.string().describe("Existing Task session to continue").optional(),
    },
    async execute(args: CallOmoAgentArgs, toolContext) {
      const toolCtx = toolContext as ToolContextWithMetadata
      log(`[call_omo_agent] Starting with agent: ${args.subagent_type}, background: ${args.run_in_background}`)

      const normalizedAgent = normalizeAgentType(args.subagent_type)
      if (!normalizedAgent) {
        return `Error: Invalid agent type "${args.subagent_type}". Only ${ALLOWED_AGENTS.join(", ")} are allowed.`
      }

      args = { ...args, subagent_type: normalizedAgent }

      if (args.run_in_background) {
        if (args.session_id) {
          return `Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.`
        }
        return await executeBackgroundAgent(args, toolCtx, backgroundManager)
      }

      return await executeSyncAgent(args, toolCtx, ctx)
    },
  })
}
