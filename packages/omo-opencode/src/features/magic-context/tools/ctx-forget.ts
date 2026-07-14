import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import type { Database } from "../db/sqlite"
import { memories } from "../db"

interface CtxForgetArgs {
  id: number
}

export function createCtxForgetTool(
  _config: MagicContextConfig,
  deps: { db: Database },
): ToolDefinition {
  return tool({
    description:
      "Forget a memory — archive it by its numeric ID so it no longer appears in future sessions. Use when a fact is wrong, obsolete, or superseded. Find IDs via ctx_list.",
    args: {
      id: tool.schema.number().describe("Memory ID to archive (use ctx_list to discover IDs)"),
    },
    async execute(args: CtxForgetArgs) {
      const id = args.id
      if (!Number.isInteger(id) || id < 1) return "Error: 'id' must be a positive integer."

      const existing = memories.getMemoryById(deps.db, id)
      if (!existing) return `Error: Memory with ID ${id} not found.`

      memories.archiveMemory(deps.db, id)
      return `Archived memory [ID: ${id}].`
    },
  })
}
