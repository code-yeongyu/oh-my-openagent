import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve, win32 } from "node:path"

import { detectPluginConfigFile } from "./jsonc-parser"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./plugin-identity"

const worktreePathCache = new Map<string, string | undefined>()

function normalizePath(path: string): string {
  const resolvedPath = process.platform !== "win32" && win32.isAbsolute(path) ? path : resolve(path)
  if (!existsSync(resolvedPath)) {
    return resolvedPath
  }

  try {
    return realpathSync.native(resolvedPath)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    try {
      return realpathSync(resolvedPath)
    } catch (fallbackError) {
      if (!(fallbackError instanceof Error)) {
        throw fallbackError
      }
      return resolvedPath
    }
  }
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function findGitMetadataRoot(startDirectory: string): string | undefined {
  let currentDirectory = normalizePath(startDirectory)

  while (true) {
    if (existsSync(join(currentDirectory, ".git"))) {
      return currentDirectory
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return undefined
    }

    currentDirectory = normalizePath(parentDirectory)
  }
}

function findAncestorDirectories(
  startDirectory: string,
  targetPaths: ReadonlyArray<ReadonlyArray<string>>,
  stopDirectory?: string,
): string[] {
  const directories: string[] = []
  const seen = new Set<string>()
  let currentDirectory = normalizePath(startDirectory)
  const resolvedStopDirectory = stopDirectory ? normalizePath(stopDirectory) : undefined
  const stopDirectoryKey = resolvedStopDirectory ? pathKey(resolvedStopDirectory) : undefined

  while (true) {
    for (const targetPath of targetPaths) {
      const candidateDirectory = join(currentDirectory, ...targetPath)
      if (!existsSync(candidateDirectory)) {
        continue
      }

      const normalizedCandidateDirectory = normalizePath(candidateDirectory)
      const candidateDirectoryKey = pathKey(normalizedCandidateDirectory)
      if (seen.has(candidateDirectoryKey)) {
        continue
      }

      seen.add(candidateDirectoryKey)
      directories.push(normalizedCandidateDirectory)
    }

    if (stopDirectoryKey === pathKey(currentDirectory)) {
      return directories
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return directories
    }

    currentDirectory = normalizePath(parentDirectory)
  }
}

export function clearWorktreeCache(): void {
  worktreePathCache.clear()
}

export function detectWorktreePath(directory: string): string | undefined {
  const resolvedDirectory = resolve(directory)
  const cacheKey = pathKey(normalizePath(resolvedDirectory))
  if (worktreePathCache.has(cacheKey)) {
    return worktreePathCache.get(cacheKey)
  }

  const gitMetadataRoot = findGitMetadataRoot(resolvedDirectory)
  if (gitMetadataRoot !== undefined) {
    worktreePathCache.set(cacheKey, gitMetadataRoot)
    return gitMetadataRoot
  }

  try {
    const worktreePath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: resolvedDirectory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    const normalizedWorktreePath = normalizePath(worktreePath)

    worktreePathCache.set(cacheKey, normalizedWorktreePath)
    return normalizedWorktreePath
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    worktreePathCache.set(cacheKey, undefined)
    return undefined
  }
}

export function findProjectClaudeSkillDirs(startDirectory: string, stopDirectory?: string): string[] {
  return findAncestorDirectories(
    startDirectory,
    [[".claude", "skills"]],
    stopDirectory ?? detectWorktreePath(startDirectory),
  )
}

export function findProjectAgentsSkillDirs(startDirectory: string, stopDirectory?: string): string[] {
  return findAncestorDirectories(
    startDirectory,
    [[".agents", "skills"]],
    stopDirectory ?? detectWorktreePath(startDirectory),
  )
}

export function findProjectOpencodeSkillDirs(startDirectory: string, stopDirectory?: string): string[] {
  return findAncestorDirectories(
    startDirectory,
    [
      [".opencode", "skills"],
      [".opencode", "skill"],
    ],
    stopDirectory ?? detectWorktreePath(startDirectory),
  )
}

export function findProjectOpencodeCommandDirs(startDirectory: string, stopDirectory?: string): string[] {
  return findAncestorDirectories(
    startDirectory,
    [
      [".opencode", "commands"],
      [".opencode", "command"],
    ],
    stopDirectory ?? detectWorktreePath(startDirectory),
  )
}

export function findProjectOpencodePluginConfigFiles(
  startDirectory: string,
  stopDirectory?: string,
): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  let currentDirectory = normalizePath(startDirectory)
  const resolvedStopDirectory = stopDirectory ? normalizePath(stopDirectory) : undefined
  const stopDirectoryKey = resolvedStopDirectory ? pathKey(resolvedStopDirectory) : undefined

  while (true) {
    const opencodeDirectory = join(currentDirectory, ".opencode")
    if (existsSync(opencodeDirectory)) {
      const detected = detectPluginConfigFile(opencodeDirectory, {
        basenames: [CONFIG_BASENAME],
        legacyBasenames: [LEGACY_CONFIG_BASENAME],
      })
      if (detected.format !== "none") {
        const detectedPathKey = pathKey(detected.path)
        if (!seen.has(detectedPathKey)) {
          seen.add(detectedPathKey)
          paths.push(detected.path)
        }
      }
    }

    if (stopDirectoryKey === pathKey(currentDirectory)) {
      return paths
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return paths
    }

    currentDirectory = normalizePath(parentDirectory)
  }
}
