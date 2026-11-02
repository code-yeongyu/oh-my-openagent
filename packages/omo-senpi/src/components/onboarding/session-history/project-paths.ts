import { homedir, tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import { realPathOr, statOrNull, type SessionHistoryFileStats, type SessionHistoryFs } from "./session-history-fs"

/** Expand a leading `~` the way a shell would; spawned CLIs record `~/...` verbatim in some setups. */
export function expandHomePath(value: string, homeDir: string): string {
  if (value === "~") return homeDir
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homeDir, value.slice(2))
  return value
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(value)
}

function trimTrailingSeparators(value: string): string {
  if (value.length === 0 || value === "/" || value === "\\" || /^[a-zA-Z]:[/\\]$/.test(value)) return value
  const trimmed = value.startsWith("/") ? value.replace(/\/+$/g, "") : value.replace(/[\\/]+$/g, "")
  if (trimmed.length === 0) return value
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed
}

/** Comparison key for a project path: trailing separators dropped, Windows paths case folded. */
export function normalizeProjectPathForComparison(value: string): string {
  const normalized = trimTrailingSeparators(value.trim())
  if (isWindowsDrivePath(normalized) || normalized.startsWith("\\\\")) {
    return normalized.replaceAll("/", "\\").toLowerCase()
  }
  return normalized
}

function normalizeForPrefixMatch(value: string, caseFold: boolean): string {
  const normalized = `${value.replaceAll("\\", "/")}/`
  return caseFold ? normalized.toLowerCase() : normalized
}

export interface ProjectPathRulesInput {
  readonly homeDir?: string
  readonly tmpDir?: string
  readonly excludedDirectories?: ReadonlyArray<string>
  readonly managedWorktreeDirectories?: ReadonlyArray<string>
  readonly platform?: NodeJS.Platform
  readonly fs: SessionHistoryFs
}

export interface ProjectPathRules {
  readonly homeDir: string
  /** Absolute, resolved path for a recorded cwd, or null when it is relative or empty. */
  resolveRecordedPath(value: string): string | null
  isExcludedProjectPath(candidatePath: string): boolean
  /** Match directory aliases without assuming the volume is case-insensitive. */
  directoryIdentity(target: string, knownStats?: SessionHistoryFileStats): Promise<string>
}

/**
 * Directories that are never offered as projects: the home and temp roots, Codex's per-conversation
 * scratch folders, Downloads, the app's own data directories, and OmO's disposable worktrees (both
 * the configured ones and the conventional `.omo-app/worktrees` / legacy `.t3/worktrees` layouts).
 */
export function createProjectPathRules(input: ProjectPathRulesInput): ProjectPathRules {
  const homeDir = resolve(input.homeDir ?? homedir())
  const caseFold = (input.platform ?? process.platform) === "win32"
  // `/private/tmp` is what macOS reports for sessions started in `/tmp`.
  const excludedRoots = new Set(
    [homeDir, input.tmpDir ?? tmpdir(), "/tmp", "/private/tmp"].map((directory) =>
      normalizeProjectPathForComparison(resolve(directory)),
    ),
  )
  const excludedAncestors = [
    join(homeDir, "Downloads"),
    join(homeDir, "Documents", "Codex"),
    ...(input.excludedDirectories ?? [join(homeDir, ".omo")]).map((directory) => resolve(directory)),
    ...(input.managedWorktreeDirectories ?? []).map((directory) => resolve(directory)),
  ].map((directory) => normalizeForPrefixMatch(directory, caseFold))

  const isExcludedProjectPath = (candidatePath: string): boolean => {
    if (excludedRoots.has(normalizeProjectPathForComparison(candidatePath))) return true
    const normalized = normalizeForPrefixMatch(candidatePath, caseFold)
    return (
      excludedAncestors.some((ancestor) => normalized.startsWith(ancestor)) ||
      normalized.includes("/.omo-app/worktrees/") ||
      normalized.includes("/.t3/worktrees/")
    )
  }

  const directoryIdentity = async (target: string, knownStats?: SessionHistoryFileStats): Promise<string> => {
    const resolved = resolve(target)
    const stats = knownStats ?? (await statOrNull(input.fs, resolved))
    if (stats !== null && stats.ino !== null) return `inode:${stats.dev}:${stats.ino}`
    return `path:${normalizeProjectPathForComparison(await realPathOr(input.fs, resolved))}`
  }

  const resolveRecordedPath = (value: string): string | null => {
    const expanded = expandHomePath(value.trim(), homeDir)
    return expanded.length > 0 && isAbsolute(expanded) ? resolve(expanded) : null
  }

  return { homeDir, resolveRecordedPath, isExcludedProjectPath, directoryIdentity }
}
