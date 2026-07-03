import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  symlinkSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"

export type CodegraphWorkspaceMode = "global-linked" | "in-place-fallback" | "in-project"
export type CodegraphProjectExclusionReason = "custom-root" | "omo-state" | "tmp-root"

export interface CodegraphWorkspacePreparation {
  readonly dataDir: string
  readonly dataRoot: string
  readonly linked: boolean
  readonly mode: CodegraphWorkspaceMode
  readonly projectLink: string
  readonly reason?: string
}

export interface CodegraphWorkspacePaths {
  readonly dataDir: string
  readonly dataRoot: string
  readonly projectLink: string
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
  readonly pruneMissingSources?: boolean
}

export interface PruneCodegraphStoreResult {
  readonly remainingBytes: number
  readonly removed: readonly string[]
}

export interface CodegraphProjectExclusionDecision {
  readonly excluded: boolean
  readonly matchedRoot?: string
  readonly reason?: CodegraphProjectExclusionReason
}

export interface CodegraphProjectExclusionOptions {
  readonly excludedRoots?: readonly string[]
  readonly homeDir?: string
  readonly platform?: NodeJS.Platform
}

interface StoreEntry {
  readonly mtimeMs: number
  readonly path: string
  readonly sizeBytes: number
}

const CODEGRAPH_PROJECT_SOURCE_METADATA_FILE = "source.json"
const CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION = 1
const POSIX_DEFAULT_EXCLUDED_ROOTS = ["/tmp", "/private/tmp"] as const

export function sanitizeBase(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-")
  return sanitized.length > 0 ? sanitized : "workspace"
}

export function codegraphDataRoot(homeDir: string): string {
  return join(homeDir, ".omo", "codegraph")
}

function workspaceStorageName(workspace: string): string {
  const resolved = resolve(workspace)
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16)
  return `${sanitizeBase(basename(resolved))}-${hash}`
}

export function resolveCodegraphWorkspacePaths(
  workspace: string,
  options: { readonly homeDir?: string } = {},
): CodegraphWorkspacePaths {
  const resolvedWorkspace = resolve(workspace)
  const dataRoot = codegraphDataRoot(options.homeDir ?? homedir())
  return {
    dataDir: join(dataRoot, "projects", workspaceStorageName(resolvedWorkspace)),
    dataRoot,
    projectLink: join(resolvedWorkspace, ".codegraph"),
  }
}

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homeDir, path.slice(2))
  return path
}

function resolveConfiguredRoot(path: string, homeDir: string): string {
  const expanded = expandHome(path, homeDir)
  return realpathIfPossible(isAbsolute(expanded) ? expanded : join(homeDir, expanded))
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function normalizeForComparison(path: string, platform: NodeJS.Platform): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

function pathIsWithin(path: string, root: string, platform: NodeJS.Platform): boolean {
  const candidate = normalizeForComparison(path, platform)
  const normalizedRoot = normalizeForComparison(root, platform)
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`)
}

function hasOmoPathSegment(path: string): boolean {
  return path.split(/[\\/]+/).includes(".omo")
}

function defaultExcludedRoots(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? [] : POSIX_DEFAULT_EXCLUDED_ROOTS
}

export function shouldExcludeCodegraphProject(
  workspace: string,
  options: CodegraphProjectExclusionOptions = {},
): CodegraphProjectExclusionDecision {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const resolvedWorkspace = realpathIfPossible(resolve(workspace))

  if (hasOmoPathSegment(resolvedWorkspace)) {
    return { excluded: true, matchedRoot: ".omo", reason: "omo-state" }
  }

  for (const root of defaultExcludedRoots(platform)) {
    const resolvedRoot = realpathIfPossible(resolve(root))
    if (pathIsWithin(resolvedWorkspace, resolvedRoot, platform)) {
      return { excluded: true, matchedRoot: root, reason: "tmp-root" }
    }
  }

  for (const root of options.excludedRoots ?? []) {
    const trimmedRoot = root.trim()
    if (trimmedRoot.length === 0) continue
    const resolvedRoot = resolveConfiguredRoot(trimmedRoot, homeDir)
    if (pathIsWithin(resolvedWorkspace, resolvedRoot, platform)) {
      return { excluded: true, matchedRoot: root, reason: "custom-root" }
    }
  }

  return { excluded: false }
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

function writeSourceMetadata(dataDir: string, sourceDir: string): void {
  writeFileSync(
    join(dataDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE),
    `${JSON.stringify({ sourceDir, version: CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION }, null, 2)}\n`,
  )
}

export function prepareCodegraphWorkspace(
  workspace: string,
  options: PrepareCodegraphWorkspaceOptions = {},
): CodegraphWorkspacePreparation {
  const resolvedWorkspace = resolve(workspace)
  const { dataDir, dataRoot, projectLink } = resolveCodegraphWorkspacePaths(resolvedWorkspace, options)

  try {
    mkdirSync(dataDir, { recursive: true })
    writeSourceMetadata(dataDir, resolvedWorkspace)

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

function readRecordedSourceDir(projectDir: string): string | null {
  const metadataPath = join(projectDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE)
  if (!existsSync(metadataPath)) return null

  try {
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const sourceDir = (parsed as { readonly sourceDir?: unknown }).sourceDir
    return typeof sourceDir === "string" && sourceDir.trim().length > 0 ? sourceDir : null
  } catch {
    return null
  }
}

function recordedSourceIsMissing(projectDir: string): boolean {
  const sourceDir = readRecordedSourceDir(projectDir)
  return sourceDir !== null && !existsSync(sourceDir)
}

function removeStoreEntry(entry: StoreEntry, removed: string[]): void {
  rmSync(entry.path, { force: true, recursive: true })
  removed.push(entry.path)
}

export function pruneCodegraphStore(options: PruneCodegraphStoreOptions): PruneCodegraphStoreResult {
  const projectsDir = join(codegraphDataRoot(options.homeDir ?? homedir()), "projects")
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1_000
  const removed: string[] = []
  let entries = readStoreEntries(projectsDir)
  let totalBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0)

  if (options.pruneMissingSources === true) {
    for (const entry of entries) {
      if (!recordedSourceIsMissing(entry.path)) continue
      removeStoreEntry(entry, removed)
      totalBytes -= entry.sizeBytes
    }
  }

  entries = entries.filter((entry) => !removed.includes(entry.path))
  for (const entry of entries) {
    if (nowMs - entry.mtimeMs <= maxAgeMs) continue
    removeStoreEntry(entry, removed)
    totalBytes -= entry.sizeBytes
  }

  entries = entries.filter((entry) => !removed.includes(entry.path))
  for (const entry of entries) {
    if (totalBytes <= options.maxBytes) break
    removeStoreEntry(entry, removed)
    totalBytes -= entry.sizeBytes
  }

  return { remainingBytes: Math.max(0, totalBytes), removed }
}

export function pruneDeadCodegraphProjectStores(options: { readonly homeDir?: string } = {}): PruneCodegraphStoreResult {
  const projectsDir = join(codegraphDataRoot(options.homeDir ?? homedir()), "projects")
  const removed: string[] = []
  if (!existsSync(projectsDir)) return { remainingBytes: 0, removed }

  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const projectDir = join(projectsDir, entry.name)
    if (!recordedSourceIsMissing(projectDir)) continue
    rmSync(projectDir, { force: true, recursive: true })
    removed.push(projectDir)
  }

  return { remainingBytes: 0, removed }
}

export function ensureCodegraphGitignored(workspace: string): boolean {
  const gitDir = join(workspace, ".git")
  if (!existsSync(gitDir)) return false

  const excludePath = join(gitDir, "info", "exclude")
  try {
    mkdirSync(join(gitDir, "info"), { recursive: true })
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : ""
    if (existing.split(/\r?\n/).includes(".codegraph")) return true
    appendFileSync(excludePath, `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}.codegraph\n`)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}
