import type {
  Diagnostic,
  DocumentSymbol,
  Location,
  LocationLink,
  PrepareRenameDefaultBehavior,
  PrepareRenameResult,
  Range,
  SeverityFilter,
  SymbolInfo,
  WorkspaceEdit,
} from "@oh-my-opencode/lsp-core"
import type { ApplyResult } from "@oh-my-opencode/lsp-core/lsp/workspace-edit-types"

import { renderDiagnosticsCall, renderDiagnosticsResult } from "./renderers-diagnostics.js"
import { renderFindReferencesCall, renderFindReferencesResult, renderGotoDefinitionCall, renderGotoDefinitionResult } from "./renderers-navigation.js"
import { renderPrepareRenameCall, renderPrepareRenameResult, renderRenameCall, renderRenameResult } from "./renderers-rename.js"
import { renderSymbolsCall, renderSymbolsResult } from "./renderers-symbols.js"
import { defineTool, Type } from "./schema.js"

export interface LspDiagnosticsDetails {
  readonly filePath: string
  readonly severity: SeverityFilter
  readonly mode: "file" | "directory"
  readonly diagnostics: readonly { readonly file: string; readonly diagnostic: Diagnostic }[]
  readonly totalDiagnostics: number
  readonly truncated: boolean
  readonly error?: string
  readonly errorKind?: "missing_dependency" | "no_files" | "invalid_path"
}

export interface LspGotoDefinitionDetails {
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly locations: readonly (Location | LocationLink)[]
  readonly error?: string
  readonly errorKind?: "missing_dependency"
}

export interface LspFindReferencesDetails {
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly references: readonly Location[]
  readonly totalReferences: number
  readonly truncated: boolean
  readonly error?: string
  readonly errorKind?: "missing_dependency"
}

export interface LspPrepareRenameDetails {
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly result: PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null
  readonly error?: string
  readonly errorKind?: "missing_dependency"
}

export interface LspRenameDetails {
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly newName: string
  readonly apply: ApplyResult | null
  readonly edit: WorkspaceEdit | null
  readonly error?: string
  readonly errorKind?: "missing_dependency"
}

export interface LspSymbolsDetails {
  readonly filePath: string
  readonly scope: "document" | "workspace"
  readonly query?: string
  readonly symbols: readonly (DocumentSymbol | SymbolInfo)[]
  readonly totalSymbols: number
  readonly truncated: boolean
  readonly error?: string
  readonly errorKind?: "missing_dependency" | "missing_query"
}

const DiagnosticsParams = Type.Object({
  filePath: Type.String({ description: "File or directory path to check diagnostics for" }),
  severity: Type.Optional(
    Type.Union(
      [
        Type.Literal("error"),
        Type.Literal("warning"),
        Type.Literal("information"),
        Type.Literal("hint"),
        Type.Literal("all"),
      ],
      { description: "Filter by severity level" },
    ),
  ),
})

const PositionParams = Type.Object({
  filePath: Type.String({ description: "Path to the source file containing the symbol" }),
  line: Type.Number({ description: "1-based line number of the symbol" }),
  character: Type.Number({ description: "0-based column of the symbol on that line" }),
})

const PrepareRenameParams = Type.Object({
  filePath: Type.String({ description: "Path to the source file" }),
  line: Type.Number({ description: "1-based line of the symbol" }),
  character: Type.Number({ description: "0-based column of the symbol on that line" }),
})

const RenameParams = Type.Object({
  filePath: Type.String({ description: "Path to the source file" }),
  line: Type.Number({ description: "1-based line of the symbol" }),
  character: Type.Number({ description: "0-based column of the symbol on that line" }),
  newName: Type.String({ description: "New symbol name" }),
})

const ReferencesParams = Type.Object({
  filePath: Type.String({ description: "Path to the source file" }),
  line: Type.Number({ description: "1-based line of the symbol" }),
  character: Type.Number({ description: "0-based column of the symbol on that line" }),
  includeDeclaration: Type.Optional(Type.Boolean({ description: "Include the declaration itself (default: true)" })),
})

const SymbolsParams = Type.Object({
  filePath: Type.String({ description: "File path used as LSP context" }),
  scope: Type.Union([Type.Literal("document"), Type.Literal("workspace")], {
    description: "'document' for file symbols, 'workspace' for project-wide search",
  }),
  query: Type.Optional(Type.String({ description: "Symbol name to search (required for workspace scope)" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default: 200)" })),
})

export const lsp_diagnostics = defineTool({
  name: "lsp_diagnostics",
  label: "LSP Diagnostics",
  description:
    "Get errors, warnings, and hints from the language server BEFORE running build. " +
    "Works for both single files and directories - file extension is auto-detected for directories.",
  parameters: DiagnosticsParams,
  renderCall: renderDiagnosticsCall,
  renderResult: renderDiagnosticsResult,
  execute: descriptorOnlyExecute,
})

export const lsp_goto_definition = defineTool({
  name: "lsp_goto_definition",
  label: "LSP Goto Definition",
  description: "Jump to symbol definition. Find WHERE something is defined.",
  parameters: PositionParams,
  renderCall: renderGotoDefinitionCall,
  renderResult: renderGotoDefinitionResult,
  execute: descriptorOnlyExecute,
})

export const lsp_find_references = defineTool({
  name: "lsp_find_references",
  label: "LSP Find References",
  description: "Find ALL usages/references of a symbol across the entire workspace.",
  parameters: ReferencesParams,
  renderCall: renderFindReferencesCall,
  renderResult: renderFindReferencesResult,
  execute: descriptorOnlyExecute,
})

export const lsp_symbols = defineTool({
  name: "lsp_symbols",
  label: "LSP Symbols",
  description:
    "Get symbols from a file (document) or search across the workspace. " +
    "Use scope='document' for a file outline, scope='workspace' for project-wide symbol search.",
  parameters: SymbolsParams,
  renderCall: renderSymbolsCall,
  renderResult: renderSymbolsResult,
  execute: descriptorOnlyExecute,
})

export const lsp_prepare_rename = defineTool({
  name: "lsp_prepare_rename",
  label: "LSP Prepare Rename",
  description: "Check if rename is valid at a given position. Use BEFORE lsp_rename.",
  parameters: PrepareRenameParams,
  renderCall: renderPrepareRenameCall,
  renderResult: renderPrepareRenameResult,
  execute: descriptorOnlyExecute,
})

export const lsp_rename = defineTool({
  name: "lsp_rename",
  label: "LSP Rename",
  description: "Rename symbol across the entire workspace. APPLIES changes to all files.",
  parameters: RenameParams,
  executionMode: "sequential",
  renderCall: renderRenameCall,
  renderResult: renderRenameResult,
  execute: descriptorOnlyExecute,
})

async function descriptorOnlyExecute(): Promise<never> {
  throw new Error("Senpi LSP descriptors must be wrapped with the packaged daemon runtime before execution")
}
