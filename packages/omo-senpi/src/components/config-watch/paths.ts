import { lstatSync, statSync } from "node:fs"
import * as nodeFs from "node:fs"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

import {
  DEFAULT_READ_FILE_SYSTEM,
  findProjectConfigPathsFarthestFirst,
  resolveHomeDir,
  resolveOmoConfigPaths,
  resolveUserOmoConfigDirectory,
  type OmoConfigEnv,
} from "@oh-my-opencode/omo-config-core"

const MAX_ANCESTOR_WATCH_TARGETS = 128
// WSL exposes Windows drives as Plan 9/v9fs mounts. Keep this exact value
// distinct from nearby filesystem magic values such as tmpfs (0x01021994).
export const PLAN9_FILE_SYSTEM_TYPE = 0x01021997

// Root-anchored: senpi maps a `dir` target to a RECURSIVE watch, so unanchored
// globs make it hash the entire subtree. A `.omo` directory also holds runtime
// state (senpi-task/ and runtime/ including runtime/ast-grep/), which reached tens of thousands of
// files and gigabytes of hashing per watcher rebuild. Config lives only at the
// top level, so anchoring keeps the scan to those two files.
export const OMO_CONFIG_FILE_FILTER_GLOBS = ["/omo.jsonc", "/omo.json"] as const
// Keep listening for config-file writes below a new `.omo` directory. If its first
// config is rejected, no reload occurs to rebuild the target set, so the original
// ancestor watch must observe the fix that clears the sticky rejection.
// The leading `/` anchors each glob to its watch root: senpi matches unanchored
// globs at any depth, which made an ancestor target cover every `.omo` directory
// in the whole subtree.
export const OMO_CONFIG_DIRECTORY_FILTER_GLOBS = ["/.omo", "/.omo/omo.jsonc", "/.omo/omo.json"] as const

/** Matches the frozen config-watch wire target shape without importing senpi internals. */
export interface OmoConfigWatchTarget {
  readonly path: string
  readonly kind: "dir"
  readonly filterGlobs: string[]
}

export type FileSystemTypeResolver = (path: string) => number | null

type NodeStatFsSync = (path: string) => { readonly type: number }

function createDefaultFileSystemTypeResolver(platform: NodeJS.Platform): FileSystemTypeResolver {
  if (platform !== "linux") return () => null
  const statFsSync = (nodeFs as typeof nodeFs & { statfsSync?: NodeStatFsSync }).statfsSync
  if (typeof statFsSync !== "function") return () => null
  return (path) => {
    try {
      return statFsSync(path).type
    } catch {
      return null
    }
  }
}

export interface ResolveOmoConfigWatchTargetsOptions {
  readonly cwd: string
  readonly env?: OmoConfigEnv
  readonly platform?: NodeJS.Platform
  readonly resolveFileSystemType?: FileSystemTypeResolver
}

export interface OmoConfigWatchTargetResolution {
  readonly targets: readonly OmoConfigWatchTarget[]
  readonly userConfigCreationWatched: boolean
  /** A later user config directory is discovered only after a full reload in this fallback state. */
  readonly userConfigCreationDiscovery: "watched" | "reload_required"
}

function containsPath(parent: string, child: string): boolean {
  const pathToChild = relative(parent, child)
  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild))
}

/**
 * senpi's config-reload host rejects targets that cover protected paths unless
 * root-anchored globs prove that each watched path avoids those paths. Mirror
 * that rule here so omo never emits a target the host would reject.
 */
function resolveSenpiProtectedPaths(env: OmoConfigEnv): readonly string[] {
  const agentDir = resolveAgentHome({ env, homeDir: resolveHomeDir(env) })
  return [join(agentDir, "auth.json"), join(agentDir, "sessions"), join(agentDir, "logs")]
}

export function isSenpiRestrictedTarget(target: OmoConfigWatchTarget, protectedPaths: readonly string[]): boolean {
  const resolvedPath = resolve(target.path)
  return protectedPaths.some((protectedPath) => {
    if (containsPath(protectedPath, resolvedPath)) {
      return true
    }
    if (!containsPath(resolvedPath, protectedPath)) return false
    return !(
      target.filterGlobs.length > 0 &&
      target.filterGlobs.every((glob) => {
        if (!glob.startsWith("/")) return false
        const globPath = resolve(resolvedPath, glob.slice(1))
        return !containsPath(globPath, protectedPath) && !containsPath(protectedPath, globPath)
      })
    )
  })
}

function findAncestorDirectories(cwd: string, homeDir: string): readonly string[] {
  const startDir = resolve(cwd)
  const resolvedHomeDir = resolve(homeDir)
  const stopDir = containsPath(resolvedHomeDir, startDir) ? resolvedHomeDir : null
  const ancestors: string[] = []
  let currentDir = startDir

  while (ancestors.length < MAX_ANCESTOR_WATCH_TARGETS) {
    ancestors.push(currentDir)
    if (stopDir !== null && currentDir === stopDir) break
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return ancestors
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isExistingNonSymlinkDirectory(path: string): boolean {
  try {
    const stats = lstatSync(path)
    return stats.isDirectory() && !stats.isSymbolicLink()
  } catch {
    return false
  }
}

function configTarget(path: string): OmoConfigWatchTarget {
  return { path, kind: "dir", filterGlobs: [...OMO_CONFIG_FILE_FILTER_GLOBS] }
}

function creationTarget(path: string): OmoConfigWatchTarget {
  return { path, kind: "dir", filterGlobs: [...OMO_CONFIG_DIRECTORY_FILTER_GLOBS] }
}

function userConfigCreationTarget(path: string, userConfigDirectory: string): OmoConfigWatchTarget {
  const directoryName = basename(userConfigDirectory)
  return {
    path,
    kind: "dir",
    filterGlobs: [
      `/${directoryName}`,
      `/${directoryName}/omo.jsonc`,
      `/${directoryName}/omo.json`,
    ],
  }
}

/**
 * Resolves all targets needed to discover existing omo config files and new
 * project `.omo` directories. The ancestor walk deliberately mirrors the
 * loader: it stops at HOME only when cwd is contained by HOME, otherwise at
 * the filesystem root.
 */
export function resolveOmoConfigWatchTargetResolution(
  options: ResolveOmoConfigWatchTargetsOptions,
): OmoConfigWatchTargetResolution {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const resolveFileSystemType = options.resolveFileSystemType ?? createDefaultFileSystemTypeResolver(platform)
  const isOnPlan9FileSystem = (path: string): boolean => resolveFileSystemType(path) === PLAN9_FILE_SYSTEM_TYPE
  const userConfigDirectory = resolveUserOmoConfigDirectory(env)
  const ancestorDirectories = findAncestorDirectories(options.cwd, resolveHomeDir(env))
  const resolvedConfigPaths = resolveOmoConfigPaths({ cwd: options.cwd, env, platform })
  const configuredProjectDirectories = new Set([
    ...resolvedConfigPaths
      .filter((candidate) => candidate.scope === "project")
      .map((candidate) => dirname(candidate.path)),
    ...findProjectConfigPathsFarthestFirst(
      options.cwd,
      resolveHomeDir(env),
      DEFAULT_READ_FILE_SYSTEM,
    ).map((path) => dirname(path)),
  ])
  const targets: OmoConfigWatchTarget[] = []

  if (isExistingDirectory(userConfigDirectory)) {
    if (!isOnPlan9FileSystem(userConfigDirectory)) targets.push(configTarget(userConfigDirectory))
  } else {
    const userConfigParent = dirname(userConfigDirectory)
    if (isExistingDirectory(userConfigParent) && !isOnPlan9FileSystem(userConfigParent)) {
      targets.push(userConfigCreationTarget(userConfigParent, userConfigDirectory))
    }
  }

  // The ancestor walk remains on the cwd's mount, so one probe covers every
  // project config and creation target without probing potentially slow paths.
  if (!isOnPlan9FileSystem(resolve(options.cwd))) {
    for (const ancestorDirectory of ancestorDirectories) {
      const omoDirectory = join(ancestorDirectory, ".omo")
      if (configuredProjectDirectories.has(omoDirectory) || isExistingNonSymlinkDirectory(omoDirectory)) {
        targets.push(configTarget(omoDirectory))
      }
    }

    for (const ancestorDirectory of ancestorDirectories) targets.push(creationTarget(ancestorDirectory))
  }

  const senpiProtectedPaths = resolveSenpiProtectedPaths(env)
  const permittedTargets = targets.filter((target) => !isSenpiRestrictedTarget(target, senpiProtectedPaths))

  // Derived from the surviving targets, since only an accepted registration can
  // discover a later user config directory.
  const userConfigCreationWatched = permittedTargets.some(
    (target) => target.path === userConfigDirectory || target.path === dirname(userConfigDirectory),
  )
  return {
    targets: permittedTargets,
    userConfigCreationWatched,
    userConfigCreationDiscovery: userConfigCreationWatched ? "watched" : "reload_required",
  }
}

export function resolveOmoConfigWatchTargets(
  options: ResolveOmoConfigWatchTargetsOptions,
): readonly OmoConfigWatchTarget[] {
  return resolveOmoConfigWatchTargetResolution(options).targets
}
