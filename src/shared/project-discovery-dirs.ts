import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { detectPluginConfigFile } from "./jsonc-parser"

const worktreePathCache = new Map<string, string | undefined>()

function normalizePath(path: string): string {
  const resolvedPath = resolve(path)
  if (!existsSync(resolvedPath)) {
    return resolvedPath
  }

  try {
    return realpathSync(resolvedPath)
  } catch {
    return resolvedPath
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

  while (true) {
    for (const targetPath of targetPaths) {
      const candidateDirectory = join(currentDirectory, ...targetPath)
      if (!existsSync(candidateDirectory) || seen.has(candidateDirectory)) {
        continue
      }

      seen.add(candidateDirectory)
      directories.push(candidateDirectory)
    }

    if (resolvedStopDirectory === currentDirectory) {
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
  if (worktreePathCache.has(resolvedDirectory)) {
    return worktreePathCache.get(resolvedDirectory)
  }

  try {
    const worktreePath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: resolvedDirectory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    worktreePathCache.set(resolvedDirectory, worktreePath)
    return worktreePath
  } catch {
    worktreePathCache.set(resolvedDirectory, undefined)
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

  while (true) {
    const opencodeDirectory = join(currentDirectory, ".opencode")
    if (existsSync(opencodeDirectory)) {
      const detected = detectPluginConfigFile(opencodeDirectory)
      if (detected.format !== "none" && !seen.has(detected.path)) {
        seen.add(detected.path)
        paths.push(detected.path)
      }
    }

    if (resolvedStopDirectory === currentDirectory) {
      return paths
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return paths
    }

    currentDirectory = normalizePath(parentDirectory)
  }
}
