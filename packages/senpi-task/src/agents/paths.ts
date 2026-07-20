import { lstatSync, readdirSync, type Dirent } from "node:fs"
import { extname, join } from "node:path"

import type { AgentLoaderDiagnostic } from "./types"

type ResolveAgentPathsOptions = {
  readonly homeDir: string
  readonly projectDir: string
}

type ListMarkdownAgentFilesResult = {
  readonly files: readonly string[]
  readonly diagnostics: readonly AgentLoaderDiagnostic[]
}

const AGENT_SUBDIRECTORIES = ["agent", "agents"] as const

export function resolveAgentDefinitionLocations(options: ResolveAgentPathsOptions): readonly string[] {
  return [
    join(options.homeDir, ".pi", "agent"),
    join(options.homeDir, ".senpi", "agent"),
    join(options.homeDir, ".senpi", "agents"),
    join(options.projectDir, ".pi"),
    join(options.projectDir, ".senpi"),
    join(options.projectDir, ".senpi", "agents"),
  ]
}

export function listMarkdownAgentFiles(location: string): ListMarkdownAgentFilesResult {
  const inspected = inspectDirectory(location, true)
  if (!inspected.ok) return { files: [], diagnostics: inspected.diagnostics }

  const files: string[] = []
  const diagnostics: AgentLoaderDiagnostic[] = []

  for (const subdir of AGENT_SUBDIRECTORIES) {
    const result = listMarkdownFiles(join(location, subdir), true)
    files.push(...result.files)
    diagnostics.push(...result.diagnostics)
  }

  return { files, diagnostics }
}

function listMarkdownFiles(dir: string, ignoreMissing: boolean): ListMarkdownAgentFilesResult {
  const inspected = inspectDirectory(dir, ignoreMissing)
  if (!inspected.ok) return { files: [], diagnostics: inspected.diagnostics }

  let entries: readonly Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" })
  } catch (error) {
    if (error instanceof Error) return { files: [], diagnostics: [readDiagnostic(dir, "scan", error)] }
    throw error
  }

  const files: string[] = []
  const diagnostics: AgentLoaderDiagnostic[] = []
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) diagnostics.push(symlinkDiagnostic(path))
    else if (entry.isDirectory()) {
      const result = listMarkdownFiles(path, false)
      files.push(...result.files)
      diagnostics.push(...result.diagnostics)
    }
    else if (entry.isFile() && extname(entry.name) === ".md") files.push(path)
  }
  return { files, diagnostics }
}

type DirectoryInspection =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly AgentLoaderDiagnostic[] }

function inspectDirectory(dir: string, ignoreMissing: boolean): DirectoryInspection {
  try {
    const stat = lstatSync(dir)
    if (stat.isSymbolicLink()) return { ok: false, diagnostics: [symlinkDiagnostic(dir)] }
    if (!stat.isDirectory()) return { ok: false, diagnostics: [notDirectoryDiagnostic(dir)] }
    return { ok: true }
  } catch (error) {
    if (error instanceof Error) {
      if (ignoreMissing && errorCode(error) === "ENOENT") return { ok: false, diagnostics: [] }
      return { ok: false, diagnostics: [readDiagnostic(dir, "inspect", error)] }
    }
    throw error
  }
}

function symlinkDiagnostic(path: string): AgentLoaderDiagnostic {
  return {
    kind: "read",
    path,
    message: `Refusing to follow symlinked agent path ${path}`,
  }
}

function notDirectoryDiagnostic(path: string): AgentLoaderDiagnostic {
  return {
    kind: "read",
    path,
    message: `Agent scan path is not a directory: ${path}`,
  }
}

function readDiagnostic(path: string, operation: "inspect" | "scan", error: Error): AgentLoaderDiagnostic {
  const code = errorCode(error)
  const codeText = code === undefined ? "" : ` (${code})`
  return {
    kind: "read",
    path,
    message: `Failed to ${operation} agent directory ${path}${codeText}: ${error.message}`,
  }
}

function errorCode(error: Error): string | undefined {
  if ("code" in error && typeof error.code === "string") return error.code
  return undefined
}
