// bytes/4 system-prompt token estimate over the working-tree system/ directory.
// Shared by `/memfs tokens` and the `/doctor` compile-warn advisory.

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

export interface SystemTokenFileEstimate {
  readonly path: string
  readonly bytes: number
  readonly tokens: number
}

export interface SystemTokenEstimate {
  readonly totalBytes: number
  readonly totalTokens: number
  /** Sorted by tokens descending, then path ascending. */
  readonly files: readonly SystemTokenFileEstimate[]
}

async function listMarkdownFiles(dir: string, prefix: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(dir, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(dir, relative)))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative)
    }
  }
  return files
}

export async function estimateSystemTokens(repoDir: string): Promise<SystemTokenEstimate> {
  const paths = await listMarkdownFiles(repoDir, "system")
  const files: SystemTokenFileEstimate[] = []
  for (const relative of paths) {
    const content = await readFile(join(repoDir, relative), "utf8")
    const bytes = Buffer.byteLength(content, "utf8")
    files.push({ path: relative, bytes, tokens: Math.ceil(bytes / 4) })
  }
  files.sort((left, right) => right.tokens - left.tokens || left.path.localeCompare(right.path))
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const totalTokens = files.reduce((sum, file) => sum + file.tokens, 0)
  return { totalBytes, totalTokens, files }
}
