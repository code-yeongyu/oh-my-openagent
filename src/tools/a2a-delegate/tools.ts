import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { OpenfangClient, OpenfangClientError } from "./openfang-client"

export const DEFAULT_OPENFANG_BASE_URL = "http://192.168.1.13:4200"

export function createA2aDelegateTool(
  _ctx: PluginInput,
  baseUrl: string = DEFAULT_OPENFANG_BASE_URL,
): Record<string, ToolDefinition> {
  const a2a_delegate: ToolDefinition = tool({
    description:
      "Delegates a task to a named agent running in the openfang daemon. " +
      "The agent executes the prompt autonomously and returns the result. " +
      "Requires the openfang daemon to be running at the configured base URL.",
    args: {
      agent: tool.schema
        .string()
        .describe("Name of the openfang agent to delegate to (e.g. \"librarian\", \"metis\")"),
      prompt: tool.schema
        .string()
        .describe("Full task prompt to send to the agent"),
      session_id: tool.schema
        .string()
        .optional()
        .describe("Optional openfang session ID for conversation continuity"),
    },
    execute: async (args, context) => {
      const client = new OpenfangClient(baseUrl)
      const abort = (context as { abort?: AbortSignal }).abort

      try {
        await client.healthCheck()
      } catch (cause) {
        const msg = cause instanceof OpenfangClientError ? cause.message : String(cause)
        return `openfang daemon unavailable: ${msg}`
      }

      let agentId: string
      try {
        const entry = await client.findAgentByName(args.agent)
        agentId = entry.id
      } catch (cause) {
        const msg = cause instanceof OpenfangClientError ? cause.message : String(cause)
        return `Failed to find openfang agent "${args.agent}": ${msg}`
      }

      try {
        return await client.sendMessage(agentId, args.prompt, abort)
      } catch (cause) {
        const msg = cause instanceof OpenfangClientError ? cause.message : String(cause)
        if (msg === "Request cancelled by caller") {
          return `[CANCELLED] openfang agent "${args.agent}" task was cancelled.`
        }
        return `openfang agent "${args.agent}" failed: ${msg}`
      }
    },
  })

  return { a2a_delegate }
}
