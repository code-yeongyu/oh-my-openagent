import { SYMBOL_KIND_MAP, SEVERITY_MAP } from "./constants"
import { uriToPath } from "./lsp-client-wrapper"
import type {
  Diagnostic,
  DocumentSymbol,
  Location,
  LocationLink,
  PrepareRenameDefaultBehavior,
  PrepareRenameResult,
  Range,
  SymbolInfo,
  TextEdit,
  WorkspaceEdit,
} from "./types"
import type { ApplyResult } from "./workspace-edit"

export function formatLocation(loc: Location | LocationLink): string {
  if ("targetUri" in loc) {
    const uri = uriToPath(loc.targetUri)
    const line = loc.targetRange.start.line + 1
    const char = loc.targetRange.start.character
    return `${uri}:${line}:${char}`
  }

  const uri = uriToPath(loc.uri)
  const line = loc.range.start.line + 1
  const char = loc.range.start.character
  return `${uri}:${line}:${char}`
}

export function formatSymbolKind(kind: number): string {
  return SYMBOL_KIND_MAP[kind] || `Unknown(${kind})`
}

export function formatSeverity(severity: number | undefined): string {
  if (!severity) return "unknown"
  return SEVERITY_MAP[severity] || `unknown(${severity})`
}

export function formatDocumentSymbol(symbol: DocumentSymbol, indent = 0): string {
  const prefix = "  ".repeat(indent)
  const kind = formatSymbolKind(symbol.kind)
  const line = symbol.range.start.line + 1
  let result = `${prefix}${symbol.name} (${kind}) - line ${line}`

  if (symbol.children && symbol.children.length > 0) {
    for (const child of symbol.children) {
      result += "\n" + formatDocumentSymbol(child, indent + 1)
    }
  }

  return result
}

export function formatSymbolInfo(symbol: SymbolInfo): string {
  const kind = formatSymbolKind(symbol.kind)
  const loc = formatLocation(symbol.location)
  const container = symbol.containerName ? ` (in ${symbol.containerName})` : ""
  return `${symbol.name} (${kind})${container} - ${loc}`
}

export function formatDiagnostic(diag: Diagnostic): string {
  const severity = formatSeverity(diag.severity)
  const line = diag.range.start.line + 1
  const char = diag.range.start.character
  const source = diag.source ? `[${diag.source}]` : ""
  const code = diag.code ? ` (${diag.code})` : ""
  return `${severity}${source}${code} at ${line}:${char}: ${diag.message}`
}

export function filterDiagnosticsBySeverity(
  diagnostics: Diagnostic[],
  severityFilter?: "error" | "warning" | "information" | "hint" | "all"
): Diagnostic[] {
  if (!severityFilter || severityFilter === "all") {
    return diagnostics
  }

  const severityMap: Record<string, number> = {
    error: 1,
    warning: 2,
    information: 3,
    hint: 4,
  }

  const targetSeverity = severityMap[severityFilter]
  return diagnostics.filter((d) => d.severity === targetSeverity)
}

export function formatPrepareRenameResult(
  result: PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null
): string {
  if (!result) return "Cannot rename at this position"

  // Case 1: { defaultBehavior: boolean }
  if ("defaultBehavior" in result) {
    return result.defaultBehavior ? "Rename supported (using default behavior)" : "Cannot rename at this position"
  }

  // Case 2: { range: Range, placeholder?: string }
  if ("range" in result && result.range) {
    const startLine = result.range.start.line + 1
    const startChar = result.range.start.character
    const endLine = result.range.end.line + 1
    const endChar = result.range.end.character
    const placeholder = result.placeholder ? ` (current: "${result.placeholder}")` : ""
    return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}${placeholder}`
  }

  // Case 3: Range directly (has start/end but no range property)
  if ("start" in result && "end" in result) {
    const startLine = result.start.line + 1
    const startChar = result.start.character
    const endLine = result.end.line + 1
    const endChar = result.end.character
    return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}`
  }

  return "Cannot rename at this position"
}

export function formatTextEdit(edit: TextEdit): string {
  const startLine = edit.range.start.line + 1
  const startChar = edit.range.start.character
  const endLine = edit.range.end.line + 1
  const endChar = edit.range.end.character

  const rangeStr = `${startLine}:${startChar}-${endLine}:${endChar}`
  const preview = edit.newText.length > 50 ? edit.newText.substring(0, 50) + "..." : edit.newText

  return `  ${rangeStr}: "${preview}"`
}

export function formatWorkspaceEdit(edit: WorkspaceEdit | null): string {
  if (!edit) return "No changes"

  const lines: string[] = []

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = uriToPath(uri)
      lines.push(`File: ${filePath}`)
      for (const textEdit of edits) {
        lines.push(formatTextEdit(textEdit))
      }
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("kind" in change) {
        if (change.kind === "create") {
          lines.push(`Create: ${change.uri}`)
        } else if (change.kind === "rename") {
          lines.push(`Rename: ${change.oldUri} -> ${change.newUri}`)
        } else if (change.kind === "delete") {
          lines.push(`Delete: ${change.uri}`)
        }
      } else {
        const filePath = uriToPath(change.textDocument.uri)
        lines.push(`File: ${filePath}`)
        for (const textEdit of change.edits) {
          lines.push(formatTextEdit(textEdit))
        }
      }
    }
  }

  if (lines.length === 0) return "No changes"

  return lines.join("\n")
}

export function formatApplyResult(result: ApplyResult): string {
  const lines: string[] = []

  if (result.success) {
    lines.push(`Applied ${result.totalEdits} edit(s) to ${result.filesModified.length} file(s):`)
    for (const file of result.filesModified) {
      lines.push(`  - ${file}`)
    }
  } else {
    lines.push("Failed to apply some changes:")
    for (const err of result.errors) {
      lines.push(`  Error: ${err}`)
    }
    if (result.filesModified.length > 0) {
      lines.push(`Successfully modified: ${result.filesModified.join(", ")}`)
    }
  }

  return lines.join("\n")
}
