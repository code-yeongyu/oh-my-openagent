import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync, readFileSync, statSync, symlinkSync } from "node:fs"
import { join } from "node:path"

import { canonicalizeCodegraphPath, resolveCodegraphWorkspacePaths, type CodegraphWorkspacePaths } from "./paths"
import { writeCodegraphSourceMetadata } from "./store"

export {
  type CodegraphProjectExclusionDecision,
  type CodegraphProjectExclusionOptions,
  type CodegraphProjectExclusionReason,
  shouldExcludeCodegraphProject,
} from "./exclusion"
export {
  canonicalizeCodegraphPath,
  codegraphDataRoot,
  resolveCodegraphWorkspacePaths,
  sanitizeBase,
  type CodegraphWorkspacePaths,
} from "./paths"
export {
  type PruneCodegraphStoreOptions,
  type PruneCodegraphStoreResult,
  pruneCodegraphStore,
  pruneDeadCodegraphProjectStores,
} from "./store"

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
  const resolvedWorkspace = canonicalizeCodegraphPath(workspace)
  const { dataDir, dataRoot, projectLink }: CodegraphWorkspacePaths = resolveCodegraphWorkspacePaths(
    resolvedWorkspace,
    options,
  )

  try {
    mkdirSync(dataDir, { recursive: true })
    writeCodegraphSourceMetadata(dataDir, resolvedWorkspace)

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
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      return fallbackResult(dataRoot, projectLink, `${reason}; fallback failed: ${fallbackReason}`)
    }
    return fallbackResult(dataRoot, projectLink, reason)
  }
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
