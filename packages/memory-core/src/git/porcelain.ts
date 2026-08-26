import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function describeDirtyMarkdownEncodingIssues(root: string, porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parsePorcelainPath)
    .filter((path): path is string => path?.endsWith(".md") ?? false)
    .map((path) => describeMarkdownEncodingIssue(root, path))
    .filter((issue): issue is string => issue !== null)
}

export function parsePorcelainPath(line: string): string | null {
  if (line.length < 4) return null
  const status = line.slice(0, 2)
  if (status === " D" || status === "D " || status === "DD") return null

  const rawPath = line.slice(3)
  const path = rawPath.includes(" -> ") ? (rawPath.split(" -> ").pop() ?? rawPath) : rawPath
  return path.replace(/^"|"$/g, "")
}

function describeMarkdownEncodingIssue(root: string, relativePath: string): string | null {
  const path = join(root, relativePath)
  if (!existsSync(path)) return null

  const bytes = readFileSync(path)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return `${relativePath} has UTF-16 LE BOM`
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return `${relativePath} has UTF-16 BE BOM`
  }
  if (bytes.includes(0)) return `${relativePath} contains NUL bytes, possibly UTF-16`
  return null
}
