import { lstatSync, statSync } from "node:fs"
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

export const OMO_CONFIG_FILE_FILTER_GLOBS = ["omo.jsonc", "omo.json"] as const
// Keep listening for config-file writes below a new `.omo` directory. If its first
// config is rejected, no reload occurs to rebuild the target set, so the original
// ancestor watch must observe the fix that clears the sticky rejection.
export const OMO_CONFIG_DIRECTORY_FILTER_GLOBS = [".omo", ".omo/omo.jsonc", ".omo/omo.json"] as const
export const USER_OMO_CONFIG_DIRECTORY_FILTER_GLOBS = ["omo"] as const

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
}

function containsPath(parent: string, child: string): boolean {
  const pathToChild = relative(parent, child)
  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild))
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
  const userConfigDirectory = resolveUserOmoConfigDirectory(env, platform)
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

  return {
    targets,
    userConfigCreationWatched: isExistingDirectory(userConfigDirectory)
      || isExistingDirectory(dirname(userConfigDirectory)),
  }
}

export function resolveOmoConfigWatchTargets(
  options: ResolveOmoConfigWatchTargetsOptions,
): readonly OmoConfigWatchTarget[] {
  return resolveOmoConfigWatchTargetResolution(options).targets
}
