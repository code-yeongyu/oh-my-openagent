import { resolve, relative, isAbsolute, basename, extname } from "node:path"

export function matchesGlobPattern(filePath: string, pattern: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, "/")
  const normalizedPattern = pattern.replace(/\\/g, "/")

  if (normalizedPattern.includes("/")) {
    if (normalizedPattern.startsWith("**/")) {
      const suffix = normalizedPattern.slice(3)

      if (suffix.includes("*")) {
        const regex = globToRegex(suffix)
        const parts = normalizedFile.split("/")
        for (const part of parts) {
          if (regex.test(part)) return true
        }
        return false
      }

      return normalizedFile.endsWith(suffix)
    }

    if (normalizedPattern.endsWith("/**")) {
      const prefix = normalizedPattern.slice(0, -3)
      return normalizedFile.startsWith(prefix + "/") || normalizedFile === prefix
    }

    if (normalizedPattern.includes("*")) {
      const regex = globToRegex(normalizedPattern)
      return regex.test(normalizedFile)
    }

    return normalizedFile === normalizedPattern ||
           normalizedFile.endsWith("/" + normalizedPattern)
  }

  if (normalizedPattern.includes("*")) {
    const regex = globToRegex(normalizedPattern)
    return regex.test(basename(normalizedFile))
  }

  return basename(normalizedFile) === normalizedPattern
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${escaped}$`)
}

export function isFileAllowed(
  filePath: string,
  workspaceRoot: string,
  allowPatterns: string[],
  denyPatterns: string[]
): { allowed: boolean; reason?: string } {
  const resolvedPath = resolve(workspaceRoot, filePath)
  const relPath = relative(workspaceRoot, resolvedPath)
  const pathToCheck = isAbsolute(relPath) ? filePath : relPath

  for (const denyPattern of denyPatterns) {
    if (matchesGlobPattern(pathToCheck, denyPattern)) {
      return { allowed: false, reason: `matches deny pattern: ${denyPattern}` }
    }
  }

  for (const allowPattern of allowPatterns) {
    if (matchesGlobPattern(pathToCheck, allowPattern)) {
      return { allowed: true }
    }
  }

  return { allowed: false, reason: "no matching allow pattern" }
}
