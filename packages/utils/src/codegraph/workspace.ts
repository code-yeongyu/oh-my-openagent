import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

export type CodegraphWorkspaceMode = "global-linked" | "in-place-fallback" | "in-project"

export interface CodegraphWorkspacePreparation {
  readonly dataDir: string
  readonly dataRoot: string
  readonly linked: boolean
  readonly mode: CodegraphWorkspaceMode
  readonly projectLink: string
  readonly reason?: string
}

export interface PrepareCodegraphWorkspaceOptions {
  readonly homeDir?: string
  readonly platform?: NodeJS.Platform
  readonly sameFilesystem?: boolean
  readonly symlink?: (target: string, path: string, type: "dir" | "junction") => void
}

export interface PruneCodegraphStoreOptions {
  readonly homeDir?: string
  readonly maxAgeDays: number
  readonly maxBytes: number
  readonly nowMs?: number
}

export interface PruneCodegraphStoreResult {
  readonly remainingBytes: number
  readonly removed: readonly string[]
}

interface StoreEntry {
  readonly mtimeMs: number
  readonly path: string
  readonly sizeBytes: number
}

export function sanitizeBase(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-")
  return sanitized.length > 0 ? sanitized : "workspace"
}

function codegraphDataRoot(homeDir: string): string {
  return join(homeDir, ".omo", "codegraph")
}

function workspaceStorageName(workspace: string): string {
  const resolved = resolve(workspace)
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16)
  return `${sanitizeBase(basename(resolved))}-${hash}`
}

function fallbackResult(
  dataRoot: string,
  projectLink: string,
  reason: string,
): CodegraphWorkspacePreparation {
  return { dataDir: projectLink, dataRoot, linked: false, mode: "in-place-fallback", projectLink, reason }
}

function isSameFilesystem(workspace: string, dataRoot: string, override: boolean | undefined): boolean {
  if (override !== undefined) return override
  return statSync(workspace).dev === statSync(dataRoot).dev
}

function ensureInPlaceFallback(projectLink: string): void {
  if (!existsSync(projectLink)) mkdirSync(projectLink, { recursive: true })
}

export function prepareCodegraphWorkspace(
  workspace: string,
  options: PrepareCodegraphWorkspaceOptions = {},
): CodegraphWorkspacePreparation {
  const resolvedWorkspace = resolve(workspace)
  const dataRoot = codegraphDataRoot(options.homeDir ?? homedir())
  const dataDir = join(dataRoot, "projects", workspaceStorageName(resolvedWorkspace))
  const projectLink = join(resolvedWorkspace, ".codegraph")

  try {
    mkdirSync(dataDir, { recursive: true })

    if (existsSync(projectLink)) {
      const linkStat = lstatSync(projectLink)
      if (!linkStat.isSymbolicLink()) {
        return { dataDir: projectLink, dataRoot, linked: false, mode: "in-project", projectLink }
      }

      if (realpathSync(projectLink) === realpathSync(dataDir)) {
        return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink }
      }

      return fallbackResult(dataRoot, projectLink, "existing .codegraph symlink points outside OMO store")
    }

    if (!isSameFilesystem(resolvedWorkspace, dataRoot, options.sameFilesystem)) {
      ensureInPlaceFallback(projectLink)
      return fallbackResult(dataRoot, projectLink, "workspace and OMO store are on different filesystems")
    }

    const symlink = options.symlink ?? symlinkSync
    symlink(dataDir, projectLink, (options.platform ?? process.platform) === "win32" ? "junction" : "dir")
    return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    try {
      ensureInPlaceFallback(projectLink)
    } catch (fallbackError) {
      return fallbackResult(dataRoot, projectLink, `${reason}; fallback failed: ${String(fallbackError)}`)
    }
    return fallbackResult(dataRoot, projectLink, reason)
  }
}

function directorySize(path: string): number {
  const entryStat = lstatSync(path)
  if (!entryStat.isDirectory()) return entryStat.size

  return readdirSync(path).reduce((total, entry) => total + directorySize(join(path, entry)), 0)
}

function readStoreEntries(projectsDir: string): StoreEntry[] {
  if (!existsSync(projectsDir)) return []
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(projectsDir, entry.name)
      return { mtimeMs: lstatSync(path).mtimeMs, path, sizeBytes: directorySize(path) }
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path))
}

export function pruneCodegraphStore(options: PruneCodegraphStoreOptions): PruneCodegraphStoreResult {
  const projectsDir = join(codegraphDataRoot(options.homeDir ?? homedir()), "projects")
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1_000
  const removed: string[] = []
  let entries = readStoreEntries(projectsDir)
  let totalBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0)

  for (const entry of entries) {
    if (nowMs - entry.mtimeMs <= maxAgeMs) continue
    rmSync(entry.path, { force: true, recursive: true })
    removed.push(entry.path)
    totalBytes -= entry.sizeBytes
  }

  entries = entries.filter((entry) => !removed.includes(entry.path))
  for (const entry of entries) {
    if (totalBytes <= options.maxBytes) break
    rmSync(entry.path, { force: true, recursive: true })
    removed.push(entry.path)
    totalBytes -= entry.sizeBytes
  }

  return { remainingBytes: Math.max(0, totalBytes), removed }
}

export function ensureCodegraphGitignored(workspace: string): boolean {
  const excludePath = join(workspace, ".git", "info", "exclude")
  try {
    mkdirSync(join(workspace, ".git", "info"), { recursive: true })
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : ""
    if (existing.split(/\r?\n/).includes(".codegraph")) return true
    appendFileSync(excludePath, `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}.codegraph\n`)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}
