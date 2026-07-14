import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import type { Database } from "../db/sqlite"
import { memories } from "../db"

interface CtxListArgs {
  limit?: number
  category?: string
}

export function createCtxListTool(
  _config: MagicContextConfig,
  deps: { db: Database; resolveProjectPath?: (directory: string) => string },
): ToolDefinition {
  return tool({
    description:
      "List active memories for the current project. Shows each memory's ID, category, and content snippet. Optionally filter by category.",
    args: {
      limit: tool.schema.number().optional().describe("Maximum memories to list (default: 20)"),
      category: tool.schema
        .string()
        .optional()
        .describe(
          "Optional category filter: ARCHITECTURE, CONSTRAINTS, NAMING, etc.",
        ),
    },
    async execute(args: CtxListArgs, toolContext) {
      const projectPath = deps.resolveProjectPath?.(toolContext.directory) ?? toolContext.directory
      const limit = args.limit ?? 20
      const category = args.category?.trim()

      const all = memories.getMemoriesByProject(deps.db, projectPath)
      const filtered = category ? all.filter((m) => m.category === category) : all
      const displayed = filtered.slice(0, limit)

      if (displayed.length === 0) {
        return category
          ? `No active memories found in category '${category}'.`
          : "No active memories found."
      }

      const rows = displayed.map(
        (m) =>
          `ID: ${m.id} | ${m.category} | ${m.content.replace(/\s+/g, " ").trim().slice(0, 120)}`,
      )

      return `Found ${displayed.length} active ${displayed.length === 1 ? "memory" : "memories"}:\n${rows.join("\n")}`
    },
  })
}
