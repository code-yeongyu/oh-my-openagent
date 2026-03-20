import { resolve } from "path"

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { DEFAULT_MAX_DIAGNOSTICS } from "./constants"
import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics"
import { filterDiagnosticsBySeverity, formatDiagnostic } from "./lsp-formatters"
import { isDirectoryPath, withLspClient } from "./lsp-client-wrapper"
import type { Diagnostic } from "./types"

export const lsp_diagnostics: ToolDefinition = tool({
  description:
    'Get errors, warnings, hints from language server BEFORE running build. For directories, provide \'extension\' parameter (e.g., extension=".ts").',
  args: {
    filePath: tool.schema.string(),
    severity: tool.schema
      .enum(["error", "warning", "information", "hint", "all"])
      .optional()
      .describe("Filter by severity level"),
    extension: tool.schema
      .string()
      .optional()
      .describe("Required if filePath is a directory. E.g., '.ts', '.py', '.go'"),
  },
  execute: async (args, _context) => {
    try {
      const absPath = resolve(args.filePath)

      if (isDirectoryPath(absPath)) {
        if (!args.extension) {
          throw new Error(
            `Directory path requires 'extension' parameter.\n\n` +
              `Example: lsp_diagnostics(filePath="src", extension=".ts")\n\n` +
              `Supported extensions: .ts, .tsx, .js, .py, .go, etc.`
          )
        }
        return await aggregateDiagnosticsForDirectory(absPath, args.extension, args.severity)
      }

      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.diagnostics(args.filePath)) as { items?: Diagnostic[] } | Diagnostic[] | null
      })

      let diagnostics: Diagnostic[] = []
      if (result) {
        if (Array.isArray(result)) {
          diagnostics = result
        } else if (result.items) {
          diagnostics = result.items
        }
      }

      diagnostics = filterDiagnosticsBySeverity(diagnostics, args.severity)

      if (diagnostics.length === 0) {
        const output = "No diagnostics found"
        return output
      }

      const total = diagnostics.length
      const truncated = total > DEFAULT_MAX_DIAGNOSTICS
      const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics
      const lines = limited.map(formatDiagnostic)
      if (truncated) {
        lines.unshift(`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      throw new Error(output)
    }
  },
})
