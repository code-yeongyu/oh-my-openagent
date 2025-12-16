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
  description: "Get type info, docs, and signature for a symbol at position.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
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
  description: "Jump to symbol definition. Find WHERE something is defined.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
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
  description: "Find ALL usages/references of a symbol across the entire workspace.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
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
  description: "Get hierarchical outline of all symbols in a file.",
  args: {
    filePath: tool.schema.string(),
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
  description: "Search symbols by name across ENTIRE workspace.",
  args: {
    filePath: tool.schema.string(),
    query: tool.schema.string().describe("Symbol name (fuzzy match)"),
    limit: tool.schema.number().optional().describe("Max results"),
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
  description: "Get errors, warnings, hints from language server BEFORE running build.",
  args: {
    filePath: tool.schema.string(),
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
  description: "List available LSP servers and installation status.",
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
  description: "Check if rename is valid. Use BEFORE lsp_rename.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
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
  description: "Rename symbol across entire workspace. APPLIES changes to all files.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
    newName: tool.schema.string().describe("New symbol name"),
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
  description: "Get available quick fixes, refactorings, and source actions (organize imports, fix all).",
  args: {
    filePath: tool.schema.string(),
    startLine: tool.schema.number().min(1).describe("1-based"),
    startCharacter: tool.schema.number().min(0).describe("0-based"),
    endLine: tool.schema.number().min(1).describe("1-based"),
    endCharacter: tool.schema.number().min(0).describe("0-based"),
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
  description: "Resolve and APPLY a code action from lsp_code_actions.",
  args: {
    filePath: tool.schema.string(),
    codeAction: tool.schema.string().describe("Code action JSON from lsp_code_actions"),
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
