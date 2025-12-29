import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { runRgFiles } from "./cli"
import { resolveGrepCliWithAutoInstall } from "./constants"
import { formatGlobResult } from "./utils"

export const glob: ToolDefinition = tool({
  description:
    "Fast file pattern matching tool with safety limits (60s timeout, 100 file limit). " +
    "Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\". " +
    "Returns matching file paths sorted by modification time. " +
    "Use this tool when you need to find files by name patterns.",
  args: {
    pattern: tool.schema.string().describe("The glob pattern to match files against"),
    path: tool.schema
      .string()
      .optional()
      .describe(
        "The directory to search in. If not specified, the current working directory will be used. " +
          "IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - " +
          "simply omit it for the default behavior. Must be a valid directory path if provided."
      ),
  },
  execute: async (args) => {
    try {
      const cli = await resolveGrepCliWithAutoInstall()
      const paths = args.path ? [args.path] : undefined

      const result = await runRgFiles(
        {
          pattern: args.pattern,
          paths,
        },
        cli
      )

      return formatGlobResult(result)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
