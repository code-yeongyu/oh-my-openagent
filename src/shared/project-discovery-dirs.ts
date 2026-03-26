import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

function findAncestorDirectories(
  startDirectory: string,
  targetPaths: ReadonlyArray<ReadonlyArray<string>>,
): string[] {
  const directories: string[] = []
  const seen = new Set<string>()
  let currentDirectory = resolve(startDirectory)

  while (true) {
    for (const targetPath of targetPaths) {
      const candidateDirectory = join(currentDirectory, ...targetPath)
      if (!existsSync(candidateDirectory) || seen.has(candidateDirectory)) {
        continue
      }

      seen.add(candidateDirectory)
      directories.push(candidateDirectory)
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return directories
    }

    currentDirectory = parentDirectory
  }
}

export function findProjectClaudeSkillDirs(startDirectory: string): string[] {
  return findAncestorDirectories(startDirectory, [[".claude", "skills"]])
}

export function findProjectAgentsSkillDirs(startDirectory: string): string[] {
  return findAncestorDirectories(startDirectory, [[".agents", "skills"]])
}

export function findProjectOpencodeSkillDirs(startDirectory: string): string[] {
  return findAncestorDirectories(startDirectory, [
    [".opencode", "skills"],
    [".opencode", "skill"],
  ])
}

export function findProjectOpencodeCommandDirs(startDirectory: string): string[] {
  return findAncestorDirectories(startDirectory, [
    [".opencode", "commands"],
    [".opencode", "command"],
  ])
}
