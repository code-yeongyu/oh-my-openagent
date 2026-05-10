import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { CLI_LANGUAGES } from "./constants"
import { runSg } from "./cli"
import { formatSearchResult, formatReplaceResult } from "./result-formatter"
import { getPatternHint } from "./pattern-hints"
import {
  AST_GREP_REPLACE_DESCRIPTION,
  AST_GREP_SEARCH_DESCRIPTION,
  AST_GREP_SEARCH_PATTERN_PARAM,
} from "./tool-descriptions"
import type { CliLanguage } from "./types"

async function showOutputToUser(context: unknown, output: string): Promise<void> {
  const ctx = context as {
    metadata?: (input: { metadata: { output: string } }) => void | Promise<void>
  }
  await ctx.metadata?.({ metadata: { output } })
}

export function createAstGrepTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const ast_grep_search: ToolDefinition = tool({
    description: AST_GREP_SEARCH_DESCRIPTION,
    args: {
      pattern: tool.schema.string().describe(AST_GREP_SEARCH_PATTERN_PARAM),
      lang: tool.schema.enum(CLI_LANGUAGES).describe("Target language"),
      paths: tool.schema.array(tool.schema.string()).optional().describe("Paths to search (default: ['.'])"),
      globs: tool.schema.array(tool.schema.string()).optional().describe("Include/exclude globs (prefix ! to exclude)"),
      context: tool.schema.number().optional().describe("Context lines around match"),
    },
    execute: async (args, context) => {
      try {
        const result = await runSg({
          pattern: args.pattern,
          lang: args.lang as CliLanguage,
          paths: args.paths ?? [ctx.directory],
          globs: args.globs,
          context: args.context,
        })

        let output = formatSearchResult(result)

        if (result.matches.length === 0 && !result.error) {
          const hint = getPatternHint(args.pattern, args.lang as CliLanguage)
          if (hint) {
            output += `\n\n${hint}`
          }
        }

        await showOutputToUser(context, output)
        return output
      } catch (e) {
        const output = `Error: ${e instanceof Error ? e.message : String(e)}`
        await showOutputToUser(context, output)
        return output
      }
    },
  })

  const ast_grep_replace: ToolDefinition = tool({
    description: AST_GREP_REPLACE_DESCRIPTION,
    args: {
      pattern: tool.schema.string().describe("AST pattern to match"),
      rewrite: tool.schema.string().describe("Replacement pattern (can use $VAR from pattern)"),
      lang: tool.schema.enum(CLI_LANGUAGES).describe("Target language"),
      paths: tool.schema.array(tool.schema.string()).optional().describe("Paths to search"),
      globs: tool.schema.array(tool.schema.string()).optional().describe("Include/exclude globs"),
      dryRun: tool.schema.boolean().optional().describe("Preview changes without applying (default: true)"),
    },
    execute: async (args, context) => {
      try {
        const result = await runSg({
          pattern: args.pattern,
          rewrite: args.rewrite,
          lang: args.lang as CliLanguage,
          paths: args.paths ?? [ctx.directory],
          globs: args.globs,
          updateAll: args.dryRun === false,
        })
        const output = formatReplaceResult(result, args.dryRun !== false)
        await showOutputToUser(context, output)
        return output
      } catch (e) {
        const output = `Error: ${e instanceof Error ? e.message : String(e)}`
        await showOutputToUser(context, output)
        return output
      }
    },
  })

  return { ast_grep_search, ast_grep_replace }
}
