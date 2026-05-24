import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

export function createCodeGraphTools(cg: { getStatus(): any; ensureIndex(): Promise<boolean> }): Record<string, ToolDefinition> {
  return {
    codegraph_status: tool({
      description: "Get CodeGraph index status.",
      args: {},
      execute: async () => JSON.stringify(cg.getStatus(), null, 2),
    }),
    codegraph_ensure_index: tool({
      description: "Ensure CodeGraph index exists.",
      args: {},
      execute: async () => JSON.stringify({ created: await cg.ensureIndex(), status: cg.getStatus() }, null, 2),
    }),
  }
}
