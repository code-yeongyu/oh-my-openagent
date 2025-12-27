import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { runRg } from "./cli"
import { formatGrepResult } from "./utils"

export const grep: ToolDefinition = tool({
  description:
    "Fast content search tool with safety limits (60s timeout, 10MB output). " +
    "Searches file contents using regular expressions. " +
    "Supports full regex syntax (eg. \"log.*Error\", \"function\\s+\\w+\", etc.). " +
    "Filter files by pattern with the include parameter (eg. \"*.js\", \"*.{ts,tsx}\"). " +
    "Returns file paths with matches sorted by modification time.",
  args: {
    pattern: tool.schema.string().describe("The regex pattern to search for in file contents"),
    include: tool.schema
      .string()
      .optional()
      .describe("File pattern to include in the search (e.g. \"*.js\", \"*.{ts,tsx}\")"),
    path: tool.schema
      .string()
      .optional()
      .describe("The directory to search in. Defaults to the current working directory."),
  },
  execute: async (args) => {
    try {
      const globs = args.include ? [args.include] : undefined
      const paths = args.path ? [args.path] : undefined

      const result = await runRg({
        pattern: args.pattern,
        paths,
        globs,
        context: 0,
      })

      return formatGrepResult(result)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
