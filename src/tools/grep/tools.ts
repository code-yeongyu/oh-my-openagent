import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { runRg, runRgCount } from "./cli"
import { formatGrepResult, formatCountResult } from "./result-formatter"

export function createGrepTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const grep: ToolDefinition = tool({
    description:
      "Fast content search tool with safety limits (60s timeout, 256KB output). " +
      "Searches file contents using regular expressions. " +
      "Supports full regex syntax (eg. \"log.*Error\", \"function\\s+\\w+\", etc.). " +
      "Filter files by pattern with the include parameter (eg. \"*.js\", \"*.{ts,tsx}\"). " +
      "Output modes: \"content\" shows matching lines, \"files_with_matches\" shows only file paths (default), \"count\" shows match counts per file.",
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
      output_mode: tool.schema
        .enum(["content", "files_with_matches", "count"])
        .optional()
        .describe(
          "Output mode: \"content\" shows matching lines, \"files_with_matches\" shows only file paths (default), \"count\" shows match counts per file."
        ),
      head_limit: tool.schema
        .number()
        .optional()
        .describe("Limit output to first N entries. 0 or omitted means no limit."),
    },
    execute: async (args) => {
      try {
        const globs = args.include ? [args.include] : undefined
        const searchPath = args.path ?? ctx.directory
        const paths = [searchPath]
        const outputMode = args.output_mode ?? "files_with_matches"
        const headLimit = args.head_limit ?? 0

        if (outputMode === "count") {
          const results = await runRgCount({
            pattern: args.pattern,
            paths,
            globs,
          })
          const limited = headLimit > 0 ? results.slice(0, headLimit) : results
          return formatCountResult(limited)
        }

        const result = await runRg({
          pattern: args.pattern,
          paths,
          globs,
          context: 0,
          outputMode,
          headLimit,
        })

        return formatGrepResult(result)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return { grep }
}
