import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

export type CodegraphProjectExclusionReason = "custom-root" | "omo-state" | "tmp-root"

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

const POSIX_DEFAULT_EXCLUDED_ROOTS = ["/tmp", "/private/tmp"] as const

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homeDir, path.slice(2))
  return path
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function resolveConfiguredRoot(path: string, homeDir: string): string {
  const expanded = expandHome(path, homeDir)
  return realpathIfPossible(isAbsolute(expanded) ? expanded : join(homeDir, expanded))
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
