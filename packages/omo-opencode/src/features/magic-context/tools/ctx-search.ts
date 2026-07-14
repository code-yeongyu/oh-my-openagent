import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import type { SearchEngine } from "../search"

interface CtxSearchArgs {
  query: string
  limit?: number
}

export function createCtxSearchTool(
  _config: MagicContextConfig,
  deps: { searchEngine: SearchEngine },
): ToolDefinition {
  return tool({
    description:
      "Search Magic Context — search across memories, compartments, commits, messages, and notes in your project history. Returns ranked results with relevance scores.",
    args: {
      query: tool.schema.string().describe("Natural language search query"),
      limit: tool.schema.number().optional().describe("Maximum results to return (default: 10)"),
    },
    async execute(args: CtxSearchArgs, toolContext) {
      const query = args.query?.trim()
      if (!query) return "Error: 'query' is required."

      const results = await deps.searchEngine.search({
        text: query,
        sessionId: toolContext.sessionID,
        projectPath: toolContext.directory ?? "",
        limit: args.limit ?? 10,
      })

      if (results.length === 0) return "No results found."

      const lines = results.map((r, i) => {
        const meta = r.metadata ? ` ${JSON.stringify(r.metadata)}` : ""
        return `[${i + 1}] [${r.source}] score=${r.score.toFixed(2)}${meta}\n${r.title}: ${r.content}`
      })

      return `Found ${results.length} result${results.length === 1 ? "" : "s"}:\n\n${lines.join("\n\n")}`
    },
  })
}
