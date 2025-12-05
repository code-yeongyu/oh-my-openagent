import { tool } from "@opencode-ai/plugin/tool"
import { CLI_LANGUAGES, NAPI_LANGUAGES, LANG_EXTENSIONS } from "./constants"
import { runSg } from "./cli"
import { analyzeCode, transformCode, getRootInfo } from "./napi"
import { formatSearchResult, formatReplaceResult, formatAnalyzeResult, formatTransformResult } from "./utils"
import type { CliLanguage, NapiLanguage } from "./types"

function showOutputToUser(context: unknown, output: string): void {
  const ctx = context as { metadata?: (input: { metadata: { output: string } }) => void }
  ctx.metadata?.({ metadata: { output } })
}

function getEmptyResultHint(pattern: string, lang: CliLanguage): string | null {
  const src = pattern.trim()

  if (lang === "python") {
    if (src.startsWith("class ") && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `💡 Hint: Remove trailing colon. Try: "${withoutColon}"`
    }
    if ((src.startsWith("def ") || src.startsWith("async def ")) && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `💡 Hint: Remove trailing colon. Try: "${withoutColon}"`
    }
  }

  if (["javascript", "typescript", "tsx"].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return `💡 Hint: Function patterns need params and body. Try "function $NAME($$$) { $$$ }"`
    }
  }

  return null
}

export const ast_grep_search = tool({
  description:
    "Search code patterns across filesystem using AST-aware matching. Supports 25 languages. " +
    "Use meta-variables: $VAR (single node), $$$ (multiple nodes). " +
    "IMPORTANT: Patterns must be complete AST nodes (valid code). " +
    "For functions, include params and body: 'export async function $NAME($$$) { $$$ }' not 'export async function $NAME'. " +
    "Examples: 'console.log($MSG)', 'def $FUNC($$$):', 'async function $NAME($$$)'",
  args: {
    pattern: tool.schema.string().describe("AST pattern with meta-variables ($VAR, $$$). Must be complete AST node."),
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
        paths: args.paths,
        globs: args.globs,
        context: args.context,
      })

      let output = formatSearchResult(result)

      if (result.matches.length === 0 && !result.error) {
        const hint = getEmptyResultHint(args.pattern, args.lang as CliLanguage)
        if (hint) {
          output += `\n\n${hint}`
        }
      }

      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})

export const ast_grep_replace = tool({
  description:
    "Replace code patterns across filesystem with AST-aware rewriting. " +
    "Dry-run by default. Use meta-variables in rewrite to preserve matched content. " +
    "Example: pattern='console.log($MSG)' rewrite='logger.info($MSG)'",
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
        paths: args.paths,
        globs: args.globs,
        updateAll: args.dryRun === false,
      })
      const output = formatReplaceResult(result, args.dryRun !== false)
      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})

export const ast_grep_languages = tool({
  description:
    "List all supported languages for ast-grep tools with their file extensions. " +
    "Use this to determine valid language options.",
  args: {},
  execute: async (_args, context) => {
    const lines: string[] = [`Supported Languages (${CLI_LANGUAGES.length}):`]
    for (const lang of CLI_LANGUAGES) {
      const exts = LANG_EXTENSIONS[lang]?.join(", ") || ""
      lines.push(`  ${lang}: ${exts}`)
    }
    lines.push("")
    lines.push(`NAPI (in-memory) languages: ${NAPI_LANGUAGES.join(", ")}`)
    const output = lines.join("\n")
    showOutputToUser(context, output)
    return output
  },
})

export const ast_grep_analyze = tool({
  description:
    "Parse code and extract AST structure with pattern matching (in-memory). " +
    "Extracts meta-variable bindings. Only for: html, javascript, tsx, css, typescript. " +
    "Use for detailed code analysis without file I/O.",
  args: {
    code: tool.schema.string().describe("Source code to analyze"),
    lang: tool.schema.enum(NAPI_LANGUAGES).describe("Language (html, javascript, tsx, css, typescript)"),
    pattern: tool.schema.string().optional().describe("Pattern to find (omit for root structure)"),
    extractMetaVars: tool.schema.boolean().optional().describe("Extract meta-variable bindings (default: true)"),
  },
  execute: async (args, context) => {
    try {
      if (!args.pattern) {
        const info = getRootInfo(args.code, args.lang as NapiLanguage)
        const output = `Root kind: ${info.kind}\nChildren: ${info.childCount}`
        showOutputToUser(context, output)
        return output
      }

      const results = analyzeCode(args.code, args.lang as NapiLanguage, args.pattern, args.extractMetaVars !== false)
      const output = formatAnalyzeResult(results, args.extractMetaVars !== false)
      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})

export const ast_grep_transform = tool({
  description:
    "Transform code in-memory using AST-aware rewriting. " +
    "Only for: html, javascript, tsx, css, typescript. " +
    "Returns transformed code without writing to filesystem.",
  args: {
    code: tool.schema.string().describe("Source code to transform"),
    lang: tool.schema.enum(NAPI_LANGUAGES).describe("Language"),
    pattern: tool.schema.string().describe("Pattern to match"),
    rewrite: tool.schema.string().describe("Replacement (can use $VAR from pattern)"),
  },
  execute: async (args, context) => {
    try {
      const { transformed, editCount } = transformCode(
        args.code,
        args.lang as NapiLanguage,
        args.pattern,
        args.rewrite
      )
      const output = formatTransformResult(args.code, transformed, editCount)
      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})
