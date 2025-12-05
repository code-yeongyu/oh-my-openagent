import { extname, resolve } from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { LSPClient, lspManager } from "./client"
import { findServerForExtension } from "./config"
import { SYMBOL_KIND_MAP, SEVERITY_MAP } from "./constants"
import type {
  HoverResult,
  DocumentSymbol,
  SymbolInfo,
  Location,
  LocationLink,
  Diagnostic,
  PrepareRenameResult,
  PrepareRenameDefaultBehavior,
  Range,
  WorkspaceEdit,
  TextEdit,
  CodeAction,
  Command,
} from "./types"

export function findWorkspaceRoot(filePath: string): string {
  let dir = resolve(filePath)

  if (!existsSync(dir) || !require("fs").statSync(dir).isDirectory()) {
    dir = require("path").dirname(dir)
  }

  const markers = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"]

  while (dir !== "/") {
    for (const marker of markers) {
      if (existsSync(require("path").join(dir, marker))) {
        return dir
      }
    }
    dir = require("path").dirname(dir)
  }

  return require("path").dirname(resolve(filePath))
}

export async function withLspClient<T>(filePath: string, fn: (client: LSPClient) => Promise<T>): Promise<T> {
  const absPath = resolve(filePath)
  const ext = extname(absPath)
  const server = findServerForExtension(ext)

  if (!server) {
    throw new Error(`No LSP server configured for extension: ${ext}`)
  }

  const root = findWorkspaceRoot(absPath)
  const client = await lspManager.getClient(root, server)

  try {
    return await fn(client)
  } catch (e) {
    if (e instanceof Error && e.message.includes("timeout")) {
      const isInitializing = lspManager.isServerInitializing(root, server.id)
      if (isInitializing) {
        throw new Error(
          `LSP server is still initializing. Please retry in a few seconds. ` +
            `Original error: ${e.message}`
        )
      }
    }
    throw e
  } finally {
    lspManager.releaseClient(root, server.id)
  }
}

export function formatHoverResult(result: HoverResult | null): string {
  if (!result) return "No hover information available"

  const contents = result.contents
  if (typeof contents === "string") {
    return contents
  }

  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .filter(Boolean)
      .join("\n\n")
  }

  if (typeof contents === "object" && "value" in contents) {
    return contents.value
  }

  return "No hover information available"
}

export function formatLocation(loc: Location | LocationLink): string {
  if ("targetUri" in loc) {
    const uri = loc.targetUri.replace("file://", "")
    const line = loc.targetRange.start.line + 1
    const char = loc.targetRange.start.character
    return `${uri}:${line}:${char}`
  }

  const uri = loc.uri.replace("file://", "")
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
      const filePath = uri.replace("file://", "")
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
        const filePath = change.textDocument.uri.replace("file://", "")
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

export function formatCodeAction(action: CodeAction): string {
  let result = `[${action.kind || "action"}] ${action.title}`

  if (action.isPreferred) {
    result += " ⭐"
  }

  if (action.disabled) {
    result += ` (disabled: ${action.disabled.reason})`
  }

  return result
}

export function formatCodeActions(actions: (CodeAction | Command)[] | null): string {
  if (!actions || actions.length === 0) return "No code actions available"

  const lines: string[] = []

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]

    if ("command" in action && typeof action.command === "string" && !("kind" in action)) {
      lines.push(`${i + 1}. [command] ${(action as Command).title}`)
    } else {
      lines.push(`${i + 1}. ${formatCodeAction(action as CodeAction)}`)
    }
  }

  return lines.join("\n")
}

export interface ApplyResult {
  success: boolean
  filesModified: string[]
  totalEdits: number
  errors: string[]
}

function applyTextEditsToFile(filePath: string, edits: TextEdit[]): { success: boolean; editCount: number; error?: string } {
  try {
    let content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    const sortedEdits = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {
        return b.range.start.line - a.range.start.line
      }
      return b.range.start.character - a.range.start.character
    })

    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line
      const startChar = edit.range.start.character
      const endLine = edit.range.end.line
      const endChar = edit.range.end.character

      if (startLine === endLine) {
        const line = lines[startLine] || ""
        lines[startLine] = line.substring(0, startChar) + edit.newText + line.substring(endChar)
      } else {
        const firstLine = lines[startLine] || ""
        const lastLine = lines[endLine] || ""
        const newContent = firstLine.substring(0, startChar) + edit.newText + lastLine.substring(endChar)
        lines.splice(startLine, endLine - startLine + 1, ...newContent.split("\n"))
      }
    }

    writeFileSync(filePath, lines.join("\n"), "utf-8")
    return { success: true, editCount: edits.length }
  } catch (err) {
    return { success: false, editCount: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export function applyWorkspaceEdit(edit: WorkspaceEdit | null): ApplyResult {
  if (!edit) {
    return { success: false, filesModified: [], totalEdits: 0, errors: ["No edit provided"] }
  }

  const result: ApplyResult = { success: true, filesModified: [], totalEdits: 0, errors: [] }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = uri.replace("file://", "")
      const applyResult = applyTextEditsToFile(filePath, edits)

      if (applyResult.success) {
        result.filesModified.push(filePath)
        result.totalEdits += applyResult.editCount
      } else {
        result.success = false
        result.errors.push(`${filePath}: ${applyResult.error}`)
      }
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("kind" in change) {
        if (change.kind === "create") {
          try {
            const filePath = change.uri.replace("file://", "")
            writeFileSync(filePath, "", "utf-8")
            result.filesModified.push(filePath)
          } catch (err) {
            result.success = false
            result.errors.push(`Create ${change.uri}: ${err}`)
          }
        } else if (change.kind === "rename") {
          try {
            const oldPath = change.oldUri.replace("file://", "")
            const newPath = change.newUri.replace("file://", "")
            const content = readFileSync(oldPath, "utf-8")
            writeFileSync(newPath, content, "utf-8")
            require("fs").unlinkSync(oldPath)
            result.filesModified.push(newPath)
          } catch (err) {
            result.success = false
            result.errors.push(`Rename ${change.oldUri}: ${err}`)
          }
        } else if (change.kind === "delete") {
          try {
            const filePath = change.uri.replace("file://", "")
            require("fs").unlinkSync(filePath)
            result.filesModified.push(filePath)
          } catch (err) {
            result.success = false
            result.errors.push(`Delete ${change.uri}: ${err}`)
          }
        }
      } else {
        const filePath = change.textDocument.uri.replace("file://", "")
        const applyResult = applyTextEditsToFile(filePath, change.edits)

        if (applyResult.success) {
          result.filesModified.push(filePath)
          result.totalEdits += applyResult.editCount
        } else {
          result.success = false
          result.errors.push(`${filePath}: ${applyResult.error}`)
        }
      }
    }
  }

  return result
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
