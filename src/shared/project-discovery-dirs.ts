import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

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

function detectWorktreePath(directory: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
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
