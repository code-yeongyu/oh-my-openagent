import type { Plugin } from "@opencode/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import type { ToolContext, ToolDefinition, ToolResult } from "@opencode-ai/plugin/tool"

export type V2ToolContext = Parameters<
  Extract<Awaited<ReturnType<Plugin.Context["tool"]["list"]>>[number], { name: string }>["execute"]
>[1]

export type V2ToolRegistration = Omit<
  Extract<Awaited<ReturnType<Plugin.Context["tool"]["list"]>>[number], { name: string }>,
  "id"
>

export interface V2ToolBridgeDeps {
  resolveDirectory(sessionID: string): Promise<string>
  defaultDirectory: string
}

function resultToV2(result: ToolResult): { content: Array<{ type: "text"; text: string }>; metadata?: Record<string, unknown> } {
  if (typeof result === "string") return { content: [{ type: "text", text: result }] }
  const content = [{ type: "text" as const, text: result.output }]
  if (result.metadata && typeof result.metadata === "object") return { content, metadata: result.metadata }
  return { content }
}

export function convertV1Tool(
  name: string,
  definition: ToolDefinition,
  deps: V2ToolBridgeDeps,
): V2ToolRegistration {
  return {
    name,
    input: tool.schema.object(definition.args),
    description: definition.description,
    execute: async (input, context: V2ToolContext) => {
      let directory = deps.defaultDirectory
      try {
        directory = await deps.resolveDirectory(context.sessionID)
      } catch {
        directory = deps.defaultDirectory
      }
      const v1context: ToolContext = {
        sessionID: context.sessionID,
        messageID: context.messageID,
        agent: context.agent,
        directory,
        worktree: directory,
        abort: context.signal,
        metadata: (entry) => {
          void context.progress({ ...(entry.metadata ?? {}), ...(entry.title ? { title: entry.title } : {}) })
        },
        ask: async () => {},
      }
      const result = await definition.execute(input as Record<string, never>, v1context)
      return resultToV2(result)
    },
  }
}
