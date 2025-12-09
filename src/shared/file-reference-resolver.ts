import { existsSync, readFileSync, statSync } from "fs"
import { join, isAbsolute } from "path"

interface FileMatch {
  fullMatch: string
  filePath: string
  start: number
  end: number
}

const FILE_REFERENCE_PATTERN = /@([^\s@]+)/g

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

function resolveFilePath(filePath: string, cwd: string): string {
  if (isAbsolute(filePath)) {
    return filePath
  }
  return join(cwd, filePath)
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
    const content = readFileContent(resolvedPath)
    replacements.set(match.fullMatch, content)
  }

  let resolved = text
  for (const [pattern, replacement] of replacements.entries()) {
    resolved = resolved.split(pattern).join(replacement)
  }

  if (findFileReferences(resolved).length > 0 && depth + 1 < maxDepth) {
    return resolveFileReferencesInText(resolved, cwd, depth + 1, maxDepth)
  }

  return resolved
}
