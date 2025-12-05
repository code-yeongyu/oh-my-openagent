import { tool } from "@opencode-ai/plugin/tool"
import { getAllServers } from "./config"
import {
  DEFAULT_MAX_REFERENCES,
  DEFAULT_MAX_SYMBOLS,
  DEFAULT_MAX_DIAGNOSTICS,
} from "./constants"
import {
  withLspClient,
  formatHoverResult,
  formatLocation,
  formatDocumentSymbol,
  formatSymbolInfo,
  formatDiagnostic,
  filterDiagnosticsBySeverity,
  formatPrepareRenameResult,
  formatWorkspaceEdit,
  formatCodeActions,
  applyWorkspaceEdit,
  formatApplyResult,
} from "./utils"
import type {
  HoverResult,
  Location,
  LocationLink,
  DocumentSymbol,
  SymbolInfo,
  Diagnostic,
  PrepareRenameResult,
  PrepareRenameDefaultBehavior,
  WorkspaceEdit,
  CodeAction,
  Command,
} from "./types"



export const lsp_hover = tool({
  description:
    "Get type information, documentation, and signature for a symbol at a specific position in a file. Use this when you need to understand what a variable, function, class, or any identifier represents.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.hover(args.filePath, args.line, args.character)) as HoverResult | null
      })
      const output = formatHoverResult(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
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
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.definition(args.filePath, args.line, args.character)) as
          | Location
          | Location[]
          | LocationLink[]
          | null
      })

      if (!result) {
        const output = "No definition found"
        return output
      }

      const locations = Array.isArray(result) ? result : [result]
      if (locations.length === 0) {
        const output = "No definition found"
        return output
      }

      const output = locations.map(formatLocation).join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
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
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.references(args.filePath, args.line, args.character, args.includeDeclaration ?? true)) as
          | Location[]
          | null
      })

      if (!result || result.length === 0) {
        const output = "No references found"
        return output
      }

      const total = result.length
      const truncated = total > DEFAULT_MAX_REFERENCES
      const limited = truncated ? result.slice(0, DEFAULT_MAX_REFERENCES) : result
      const lines = limited.map(formatLocation)
      if (truncated) {
        lines.unshift(`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_document_symbols = tool({
  description:
    "Get a hierarchical outline of all symbols (classes, functions, methods, variables, types, constants) in a single file. Use this to quickly understand a file's structure.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.documentSymbols(args.filePath)) as DocumentSymbol[] | SymbolInfo[] | null
      })

      if (!result || result.length === 0) {
        const output = "No symbols found"
        return output
      }

      const total = result.length
      const truncated = total > DEFAULT_MAX_SYMBOLS
      const limited = truncated ? result.slice(0, DEFAULT_MAX_SYMBOLS) : result

      const lines: string[] = []
      if (truncated) {
        lines.push(`Found ${total} symbols (showing first ${DEFAULT_MAX_SYMBOLS}):`)
      }

      if ("range" in limited[0]) {
        lines.push(...(limited as DocumentSymbol[]).map((s) => formatDocumentSymbol(s)))
      } else {
        lines.push(...(limited as SymbolInfo[]).map(formatSymbolInfo))
      }
      return lines.join("\n")
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
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
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.workspaceSymbols(args.query)) as SymbolInfo[] | null
      })

      if (!result || result.length === 0) {
        const output = "No symbols found"
        return output
      }

      const total = result.length
      const limit = Math.min(args.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS)
      const truncated = total > limit
      const limited = result.slice(0, limit)
      const lines = limited.map(formatSymbolInfo)
      if (truncated) {
        lines.unshift(`Found ${total} symbols (showing first ${limit}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
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
  execute: async (args, context) => {
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
      return output
    }
  },
})

export const lsp_servers = tool({
  description: "List all available LSP servers and check if they are installed. Use this to see what language support is available.",
  args: {},
  execute: async (_args, context) => {
    try {
      const servers = getAllServers()
      const lines = servers.map((s) => {
        if (s.disabled) {
          return `${s.id} [disabled] - ${s.extensions.join(", ")}`
        }
        const status = s.installed ? "[installed]" : "[not installed]"
        return `${s.id} ${status} - ${s.extensions.join(", ")}`
      })
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_prepare_rename = tool({
  description:
    "Check if a symbol at a specific position can be renamed. Use this BEFORE attempting to rename to validate the operation and get the current symbol name.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.prepareRename(args.filePath, args.line, args.character)) as
          | PrepareRenameResult
          | PrepareRenameDefaultBehavior
          | null
      })
      const output = formatPrepareRenameResult(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_rename = tool({
  description:
    "Rename a symbol across the entire workspace. This APPLIES the rename to all files. Use lsp_prepare_rename first to check if rename is possible.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    line: tool.schema.number().min(1).describe("Line number (1-based)"),
    character: tool.schema.number().min(0).describe("Character position (0-based)"),
    newName: tool.schema.string().describe("The new name for the symbol"),
  },
  execute: async (args, context) => {
    try {
      const edit = await withLspClient(args.filePath, async (client) => {
        return (await client.rename(args.filePath, args.line, args.character, args.newName)) as WorkspaceEdit | null
      })
      const result = applyWorkspaceEdit(edit)
      const output = formatApplyResult(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_code_actions = tool({
  description:
    "Get available code actions for a range in the file. Code actions include quick fixes, refactorings (extract, inline, rewrite), and source actions (organize imports, fix all). Use this to discover what automated changes the language server can perform.",
  args: {
    filePath: tool.schema.string().describe("The absolute path to the file"),
    startLine: tool.schema.number().min(1).describe("Start line number (1-based)"),
    startCharacter: tool.schema.number().min(0).describe("Start character position (0-based)"),
    endLine: tool.schema.number().min(1).describe("End line number (1-based)"),
    endCharacter: tool.schema.number().min(0).describe("End character position (0-based)"),
    kind: tool.schema
      .enum([
        "quickfix",
        "refactor",
        "refactor.extract",
        "refactor.inline",
        "refactor.rewrite",
        "source",
        "source.organizeImports",
        "source.fixAll",
      ])
      .optional()
      .describe("Filter by code action kind"),
  },
  execute: async (args, context) => {
    try {
      const only = args.kind ? [args.kind] : undefined
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.codeAction(
          args.filePath,
          args.startLine,
          args.startCharacter,
          args.endLine,
          args.endCharacter,
          only
        )) as (CodeAction | Command)[] | null
      })
      const output = formatCodeActions(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_code_action_resolve = tool({
  description:
    "Resolve and APPLY a code action. This resolves the full details and applies the changes to files. Use after getting a code action from lsp_code_actions.",
  args: {
    filePath: tool.schema
      .string()
      .describe("The absolute path to a file in the workspace (used to find the LSP server)"),
    codeAction: tool.schema.string().describe("The code action JSON object as returned by lsp_code_actions (stringified)"),
  },
  execute: async (args, context) => {
    try {
      const codeAction = JSON.parse(args.codeAction) as CodeAction
      const resolved = await withLspClient(args.filePath, async (client) => {
        return (await client.codeActionResolve(codeAction)) as CodeAction | null
      })

      if (!resolved) {
        const output = "Failed to resolve code action"
        return output
      }

      const lines: string[] = []
      lines.push(`Action: ${resolved.title}`)
      if (resolved.kind) lines.push(`Kind: ${resolved.kind}`)

      if (resolved.edit) {
        const result = applyWorkspaceEdit(resolved.edit)
        lines.push(formatApplyResult(result))
      } else {
        lines.push("No edit to apply")
      }

      if (resolved.command) {
        lines.push(`Command: ${resolved.command.title} (${resolved.command.command}) - not executed`)
      }

      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})
