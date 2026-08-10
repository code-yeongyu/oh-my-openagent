import { lstatSync, statSync } from "node:fs"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import {
  DEFAULT_READ_FILE_SYSTEM,
  findProjectConfigPathsFarthestFirst,
  resolveHomeDir,
  resolveOmoConfigPaths,
  resolveUserOmoConfigDirectory,
  type OmoConfigEnv,
} from "@oh-my-opencode/omo-config-core"

const MAX_ANCESTOR_WATCH_TARGETS = 128
const SENPI_AGENT_DIR_ENV = "SENPI_CODING_AGENT_DIR"

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
export const USER_OMO_CONFIG_DIRECTORY_FILTER_GLOBS = ["/omo"] as const

/** Matches the frozen config-watch wire target shape without importing senpi internals. */
export interface OmoConfigWatchTarget {
  readonly path: string
  readonly kind: "dir"
  readonly filterGlobs: string[]
}

export interface ResolveOmoConfigWatchTargetsOptions {
  readonly cwd: string
  readonly env?: OmoConfigEnv
  readonly platform?: NodeJS.Platform
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
 * senpi's config-reload host rejects every registration whose watch targets
 * cover the senpi agent dir's protected paths (auth.json, sessions/, logs/).
 * A bare-$HOME ancestor target always covers them, so the rejection is
 * deterministic and must be avoided here instead of retried. Tradeoff: a NEW
 * `.omo` directory created directly in the $HOME root is no longer
 * auto-discovered; it is picked up on the next session start (an existing
 * `$HOME/.omo` config target is still watched, and `$HOME` ancestors below it
 * are unaffected).
 */
function resolveSenpiProtectedPaths(env: OmoConfigEnv): readonly string[] {
  const agentDir = resolveAgentHome({ env, homeDir: resolveHomeDir(env) })
  return [join(agentDir, "auth.json"), join(agentDir, "sessions"), join(agentDir, "logs")]
}

function isSenpiRestrictedTarget(path: string, protectedPaths: readonly string[]): boolean {
  const resolvedPath = resolve(path)
  return protectedPaths.some(
    (protectedPath) => containsPath(resolvedPath, protectedPath) || containsPath(protectedPath, resolvedPath),
  )
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

function userConfigCreationTarget(path: string): OmoConfigWatchTarget {
  return { path, kind: "dir", filterGlobs: [...USER_OMO_CONFIG_DIRECTORY_FILTER_GLOBS] }
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
    targets.push(configTarget(userConfigDirectory))
  } else {
    const userConfigParent = dirname(userConfigDirectory)
    if (isExistingDirectory(userConfigParent)) targets.push(userConfigCreationTarget(userConfigParent))
  }

  for (const ancestorDirectory of ancestorDirectories) {
    const omoDirectory = join(ancestorDirectory, ".omo")
    if (configuredProjectDirectories.has(omoDirectory) || isExistingNonSymlinkDirectory(omoDirectory)) {
      targets.push(configTarget(omoDirectory))
    }
  }

  for (const ancestorDirectory of ancestorDirectories) targets.push(creationTarget(ancestorDirectory))

  const senpiProtectedPaths = resolveSenpiProtectedPaths(env)
  const permittedTargets = targets.filter((target) => !isSenpiRestrictedTarget(target.path, senpiProtectedPaths))

  // Derived from the SURVIVING targets, not from directory existence: `~/.omo`'s parent
  // is `$HOME`, whose creation target is always dropped by the protected-path filter, so
  // an existence check would report a watch that was never registered.
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
