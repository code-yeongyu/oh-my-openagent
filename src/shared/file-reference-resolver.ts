import { existsSync, readFileSync, statSync } from "fs"
import { homedir } from "os"
import { isAbsolute, posix, resolve, win32 } from "path"
import { isWithinProject } from "./contains-path"
import { log } from "./logger"

interface FileMatch {
  fullMatch: string
  filePath: string
  start: number
  end: number
}

const FILE_REFERENCE_PATTERN = /@([^\s@]+)/g

function isPosixAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/")
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")
}

function expandEnvironmentVariable(match: string, variableName: string | undefined): string {
  if (!variableName) {
    return match
  }

  const value = process.env[variableName]
  if (value !== undefined) {
    return value
  }

  if (variableName === "HOME") {
    return homedir()
  }

  return match
}

function resolvePathForInput(filePath: string, cwd: string): string {
  if (isWindowsAbsolutePath(filePath)) {
    return win32.resolve(filePath)
  }

  if (isPosixAbsolutePath(filePath) || isPosixAbsolutePath(cwd)) {
    return posix.resolve(cwd, filePath)
  }

  if (isWindowsAbsolutePath(cwd)) {
    return win32.resolve(cwd, filePath)
  }

  return resolve(cwd, filePath)
}

function findFileReferences(text: string): FileMatch[] {
  const matches: FileMatch[] = []
  let match: RegExpExecArray | null

  FILE_REFERENCE_PATTERN.lastIndex = 0

  while ((match = FILE_REFERENCE_PATTERN.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      filePath: match[1],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return matches
}

export function resolveFilePath(filePath: string, cwd: string): string {
  const expanded = filePath.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced: string | undefined, bare: string | undefined) => {
    return expandEnvironmentVariable(match, braced ?? bare)
  })

  if (isAbsolute(expanded) || isPosixAbsolutePath(expanded) || isWindowsAbsolutePath(expanded)) {
    return resolvePathForInput(expanded, cwd)
  }

  return resolvePathForInput(expanded, cwd)
}

function readFileContent(resolvedPath: string): string {
  if (!existsSync(resolvedPath)) {
    return `[file not found: ${resolvedPath}]`
  }

  const stat = statSync(resolvedPath)
  if (stat.isDirectory()) {
    return `[cannot read directory: ${resolvedPath}]`
  }

  const content = readFileSync(resolvedPath, "utf-8")
  return content
}

export async function resolveFileReferencesInText(
  text: string,
  cwd: string = process.cwd(),
  depth: number = 0,
  maxDepth: number = 3
): Promise<string> {
  if (depth >= maxDepth) {
    return text
  }

  const matches = findFileReferences(text)
  if (matches.length === 0) {
    return text
  }

  const replacements = new Map<string, string>()

  for (const match of matches) {
    const resolvedPath = resolveFilePath(match.filePath, cwd)

    if (!isWithinProject(resolvedPath, cwd)) {
      log("[file-reference-resolver] Rejected file reference outside project root", {
        filePath: match.filePath,
        resolvedPath,
        projectRoot: cwd,
      })
      replacements.set(match.fullMatch, `[path rejected: ${match.filePath}]`)
      continue
    }

    const content = readFileContent(resolvedPath)
    replacements.set(match.fullMatch, content)
  }

  let resolved = text
  for (const [pattern, replacement] of replacements.entries()) {
    resolved = resolved.replaceAll(pattern, replacement)
  }

  if (findFileReferences(resolved).length > 0 && depth + 1 < maxDepth) {
    return resolveFileReferencesInText(resolved, cwd, depth + 1, maxDepth)
  }

  return resolved
}
