import { extname, resolve } from "path"
import { existsSync } from "fs"
import { LSPClient } from "./client"
import { findServerForExtension } from "./config"
import { SYMBOL_KIND_MAP, SEVERITY_MAP } from "./constants"
import type { HoverResult, DocumentSymbol, SymbolInfo, Location, LocationLink, Diagnostic } from "./types"

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
  const client = new LSPClient(root, server)

  await client.start()
  await client.initialize()

  try {
    return await fn(client)
  } finally {
    await client.stop()
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
