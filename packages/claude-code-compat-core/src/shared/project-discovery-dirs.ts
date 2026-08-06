import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve, win32 } from "node:path"

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

function detectWorktreePath(directory: string): string | undefined {
  const resolvedDirectory = resolve(directory)
  const cacheKey = pathKey(normalizePath(resolvedDirectory))
  if (worktreePathCache.has(cacheKey)) {
    return worktreePathCache.get(cacheKey)
  }

  const gitMarkerAncestor = findGitMarkerAncestor(resolvedDirectory)
  if (gitMarkerAncestor !== undefined) {
    worktreePathCache.set(cacheKey, gitMarkerAncestor)
    return gitMarkerAncestor
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

function findGitMarkerAncestor(directory: string): string | undefined {
  let currentDirectory = normalizePath(directory)

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

export function findProjectOpencodeCommandDirs(startDirectory: string, stopDirectory?: string): string[] {
  const detectedStopDirectory = stopDirectory ?? detectWorktreePath(startDirectory) ?? findGitMarkerAncestor(startDirectory)

  return findAncestorDirectories(
    startDirectory,
    [
      [".opencode", "commands"],
      [".opencode", "command"],
    ],
    detectedStopDirectory,
  )
}
