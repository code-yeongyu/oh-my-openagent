import { existsSync, lstatSync, readdirSync, type Stats } from "node:fs"
import { join, resolve } from "node:path"
import { contextCwd } from "../request-context.js"
import { formatServerLookupError } from "./client-wrapper.js"
import { DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_DIRECTORY_FILES } from "./constants.js"
import { scanServedGroups } from "./directory-group-scan.js"
import { groupFilesByClient } from "./directory-server-groups.js"
import { effectiveExtension } from "./effective-extension.js"
import { LspInvalidPathError, LspServerLookupError } from "./errors.js"
import { filterDiagnosticsBySeverity, formatDiagnostic } from "./formatters.js"
import { getLspManager, type LspManager } from "./manager.js"
import type { TimerProvider } from "./timer-provider.js"
import type { Diagnostic, ResolvedServer, SeverityFilter } from "./types.js"

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "out"])
const DIRECTORY_DIAGNOSTICS_MAX_CONCURRENCY = 4

interface FileDiagnostic {
  filePath: string
  diagnostic: Diagnostic
}

export interface DirectoryDiagnosticsFileFailure {
  readonly file: string
  readonly error: string
}

export interface DirectoryDiagnosticsResult {
  readonly output: string
  readonly totalDiagnostics: number
  readonly fileFailures: readonly DirectoryDiagnosticsFileFailure[]
}

export interface DirectoryDiagnosticsOptions {
  readonly listFiles?: (directory: string, extension: string, maxFiles: number) => string[]
  readonly manager?: LspManager
  readonly maxConcurrency?: number
  readonly workspaceRoot?: string
  readonly server?: ResolvedServer
  readonly signal?: AbortSignal
  readonly timers?: TimerProvider
}

export function collectFilesWithExtension(dir: string, extension: string, maxFiles: number): string[] {
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

      if (!stat || stat.isSymbolicLink()) continue

      if (stat.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          walk(fullPath)
        }
      } else if (stat.isFile() && effectiveExtension(fullPath) === extension) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files
}

export async function aggregateDiagnosticsForDirectory(
  directory: string,
  extension: string,
  severity?: SeverityFilter,
  maxFiles: number = DEFAULT_MAX_DIRECTORY_FILES,
  options: DirectoryDiagnosticsOptions = {},
): Promise<DirectoryDiagnosticsResult> {
  if (!extension.startsWith(".")) {
    throw new LspInvalidPathError(
      `Extension must start with a dot (e.g., ".ts", not "${extension}"). Use ".${extension}" instead.`,
    )
  }

  const absDir = resolve(options.workspaceRoot ?? contextCwd(), directory)
  if (!existsSync(absDir)) {
    throw new LspInvalidPathError(`Directory does not exist: ${absDir}`)
  }

  const allFiles = (options.listFiles ?? collectFilesWithExtension)(absDir, extension, maxFiles + 1)
  const wasCapped = allFiles.length > maxFiles
  const filesToProcess = allFiles.slice(0, maxFiles)

  if (filesToProcess.length === 0) {
    const output = [
      `Directory: ${absDir}`,
      `Extension: ${extension}`,
      "Files scanned: 0",
      `No files found with extension "${extension}".`,
    ].join("\n")
    return { output, totalDiagnostics: 0, fileFailures: [] }
  }

  // Each file goes to the client a single-file request for it would use; one scan at a repository root
  // can span packages served by different servers. File cap and concurrency stay per request.
  const groups = groupFilesByClient(filesToProcess, extension, {
    ...(options.server === undefined ? {} : { server: options.server }),
    ...(options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
  })
  const firstUnserved = groups.unserved[0]
  if (groups.served.length === 0 && firstUnserved !== undefined) {
    throw new LspServerLookupError(formatServerLookupError(firstUnserved.lookup))
  }

  const manager = options.manager ?? getLspManager()
  const allDiagnostics: FileDiagnostic[] = []
  const fileErrors: DirectoryDiagnosticsFileFailure[] = []
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DIRECTORY_DIAGNOSTICS_MAX_CONCURRENCY)
  for (const group of groups.unserved) {
    const error = formatServerLookupError(group.lookup).split("\n")[0] ?? "No LSP server"
    fileErrors.push(...group.files.map((file) => ({ file, error })))
  }

  options.signal?.throwIfAborted()
  await scanServedGroups({
    manager,
    groups: groups.served,
    maxConcurrency,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    onGroupUnavailable: (group, error) => {
      fileErrors.push(...group.files.map((file) => ({ file, error })))
    },
    checkFile: async (client, file) => {
      try {
        const result = await client.diagnostics(file, options.signal)
        const filtered = filterDiagnosticsBySeverity(result.items, severity)
        allDiagnostics.push(...filtered.map((diagnostic) => ({ filePath: file, diagnostic })))
      } catch (e) {
        fileErrors.push({ file, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })

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
    for (const { filePath, diagnostic } of displayDiagnostics) {
      lines.push(`${filePath}: ${formatDiagnostic(diagnostic)}`)
    }
    if (wasDiagCapped) {
      lines.push("", `... (${allDiagnostics.length - DEFAULT_MAX_DIAGNOSTICS} more diagnostics not shown)`)
    }
  }

  return { output: lines.join("\n"), totalDiagnostics: allDiagnostics.length, fileFailures: fileErrors }
}
