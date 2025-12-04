import { tool } from "@opencode-ai/plugin/tool"
import { getAllServers } from "./config"
import {
  withLspClient,
  formatHoverResult,
  formatLocation,
  formatDocumentSymbol,
  formatSymbolInfo,
  formatDiagnostic,
  filterDiagnosticsBySeverity,
} from "./utils"
import type { HoverResult, Location, LocationLink, DocumentSymbol, SymbolInfo, Diagnostic } from "./types"

export const lsp_hover = tool({
  description:
    "Get type information, documentation, and signature for a symbol at a specific position in a file. Use this when you need to understand what a variable, function, class, or any identifier represents.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.hover(args.filePath, args.line, args.character)) as HoverResult | null
      })
      return formatHoverResult(result)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_goto_definition = tool({
  description:
    "Jump to the source definition of a symbol (variable, function, class, type, import, etc.). Use this when you need to find WHERE something is defined.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.definition(args.filePath, args.line, args.character)) as
          | Location
          | Location[]
          | LocationLink[]
          | null
      })

      if (!result) return "No definition found"

      const locations = Array.isArray(result) ? result : [result]
      if (locations.length === 0) return "No definition found"

      return locations.map(formatLocation).join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_find_references = tool({
  description:
    "Find ALL usages/references of a symbol across the entire workspace. Use this when you need to understand the impact of changing something.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
    includeDeclaration: tool.schema.boolean().optional().describe("Include the declaration itself"),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.references(args.filePath, args.line, args.character, args.includeDeclaration ?? true)) as
          | Location[]
          | null
      })

      if (!result || result.length === 0) return "No references found"

      return result.map(formatLocation).join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_document_symbols = tool({
  description:
    "Get a hierarchical outline of all symbols (classes, functions, methods, variables, types, constants) in a single file. Use this to quickly understand a file's structure.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.documentSymbols(args.filePath)) as DocumentSymbol[] | SymbolInfo[] | null
      })

      if (!result || result.length === 0) return "No symbols found"

      if ("range" in result[0]) {
        return (result as DocumentSymbol[]).map((s) => formatDocumentSymbol(s)).join("\n")
      }
      return (result as SymbolInfo[]).map(formatSymbolInfo).join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_workspace_symbols = tool({
  description:
    "Search for symbols by name across the ENTIRE workspace/project. Use this when you know (or partially know) a symbol's name but don't know which file it's in.",
  args: {
    filePath: tool.schema.string().describe("A file path in the workspace to determine the workspace root"),
    query: tool.schema.string().describe("The symbol name to search for (supports fuzzy matching)"),
    limit: tool.schema.number().optional().describe("Maximum number of results to return"),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.workspaceSymbols(args.query)) as SymbolInfo[] | null
      })

      if (!result || result.length === 0) return "No symbols found"

      const limited = args.limit ? result.slice(0, args.limit) : result
      return limited.map(formatSymbolInfo).join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_diagnostics = tool({
  description:
    "Get all errors, warnings, and hints for a file from the language server. Use this to check if code has type errors, syntax issues, or linting problems BEFORE running the build.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    severity: tool.schema
      .enum(["error", "warning", "information", "hint", "all"])
      .optional()
      .describe("Filter by severity level"),
  },
  execute: async (args) => {
    try {
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

      if (diagnostics.length === 0) return "No diagnostics found"

      return diagnostics.map(formatDiagnostic).join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_servers = tool({
  description: "List all available LSP servers and check if they are installed. Use this to see what language support is available.",
  args: {},
  execute: async () => {
    try {
      const servers = getAllServers()
      const lines = servers.map((s) => {
        if (s.disabled) {
          return `${s.id} [disabled] - ${s.extensions.join(", ")}`
        }
        const status = s.installed ? "[installed]" : "[not installed]"
        return `${s.id} ${status} - ${s.extensions.join(", ")}`
      })
      return lines.join("\n")
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
