import { existsSync, lstatSync, readdirSync, type Stats } from "fs"
import { extname, join, resolve } from "path"

import { findServerForExtension } from "./config"
import { findWorkspaceRoot, formatServerLookupError } from "./lsp-client-wrapper"
import { filterDiagnosticsBySeverity, formatDiagnostic } from "./lsp-formatters"
import { LSPClient } from "./lsp-client"
import { lspManager } from "./lsp-server"
import { DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_DIRECTORY_FILES } from "./constants"
import type { Diagnostic } from "./types"

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "out"])

function collectFilesWithExtension(dir: string, extension: string, maxFiles: number): string[] {
  const files: string[] = []

  function walk(currentDir: string): void {
    if (files.length >= maxFiles) return

    let entries: string[] = []
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return

      const fullPath = join(currentDir, entry)

      let stat: Stats | undefined
      try {
        stat = lstatSync(fullPath)
      } catch {
        continue
      }

      if (!stat || stat.isSymbolicLink()) {
        continue
      }

      if (stat.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          walk(fullPath)
        }
      } else if (stat.isFile()) {
        if (extname(fullPath) === extension) {
          files.push(fullPath)
        }
      }
    }
  }

  walk(dir)
  return files
}

export async function aggregateDiagnosticsForDirectory(
  directory: string,
  extension: string,
  severity?: "error" | "warning" | "information" | "hint" | "all",
  maxFiles: number = DEFAULT_MAX_DIRECTORY_FILES
): Promise<string> {
  if (!extension.startsWith(".")) {
    throw new Error(
      `Extension must start with a dot (e.g., ".ts", not "${extension}"). ` +
        `Use ".${extension}" instead.`
    )
  }

  const absDir = resolve(directory)
  if (!existsSync(absDir)) {
    throw new Error(`Directory does not exist: ${absDir}`)
  }

  const serverResult = findServerForExtension(extension)
  if (serverResult.status !== "found") {
    throw new Error(formatServerLookupError(serverResult))
  }

  const server = serverResult.server
  const allFiles = collectFilesWithExtension(absDir, extension, maxFiles + 1)
  const wasCapped = allFiles.length > maxFiles
  const filesToProcess = allFiles.slice(0, maxFiles)

  const root = findWorkspaceRoot(absDir)

  const allDiagnostics: Diagnostic[] = []
  const fileErrors: { file: string; error: string }[] = []

  let client: LSPClient
  try {
    client = await lspManager.getClient(root, server)

    for (const file of filesToProcess) {
      try {
        const result = await client.diagnostics(file)
        const filtered = filterDiagnosticsBySeverity(result.items, severity)
        allDiagnostics.push(...filtered)
      } catch (e) {
        fileErrors.push({
          file,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  } finally {
    lspManager.releaseClient(root, server.id)
  }

  const displayDiagnostics = allDiagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS)
  const wasDiagCapped = allDiagnostics.length > DEFAULT_MAX_DIAGNOSTICS

  const lines: string[] = [
    `Directory: ${absDir}`,
    `Extension: ${extension}`,
    `Files scanned: ${filesToProcess.length}${wasCapped ? ` (capped at ${maxFiles})` : ""}`,
    `Files with errors: ${fileErrors.length}`,
    `Total diagnostics: ${allDiagnostics.length}`,
  ]

  if (fileErrors.length > 0) {
    lines.push("", "File processing errors:")
    for (const { file, error } of fileErrors) {
      lines.push(`  ${file}: ${error}`)
    }
  }

  if (displayDiagnostics.length > 0) {
    lines.push("")
    for (const diag of displayDiagnostics) {
      lines.push(formatDiagnostic(diag))
    }
    if (wasDiagCapped) {
      lines.push(
        "",
        `... (${allDiagnostics.length - DEFAULT_MAX_DIAGNOSTICS} more diagnostics not shown)`
      )
    }
  }

  return lines.join("\n")
}
