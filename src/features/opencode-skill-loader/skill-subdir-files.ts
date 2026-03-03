import { promises as fs } from "fs"
import { join, resolve, relative } from "path"
import { isMarkdownFile } from "../../shared/file-utils"

const IGNORED_NAMES = new Set(["SKILL.md"])

/**
 * List all non-SKILL.md files in a skill's resolved directory.
 * Returns relative paths (e.g., "references/api.md", "templates/fix.md").
 */
export async function listSkillSubdirFiles(resolvedPath: string): Promise<string[]> {
  const results: string[] = []
  await collectFiles(resolvedPath, resolvedPath, results)
  return results.sort()
}

async function collectFiles(baseDir: string, dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(baseDir, fullPath, results)
    } else if (isMarkdownFile(entry) && !IGNORED_NAMES.has(entry.name)) {
      results.push(relative(baseDir, fullPath))
    } else if (!entry.isDirectory() && !isMarkdownFile(entry)) {
      results.push(relative(baseDir, fullPath))
    }
  }
}

/**
 * Read a specific file from a skill's resolved directory.
 * The `file` path is relative to the skill's resolvedPath.
 * Rejects path traversal attempts.
 */
export async function readSkillSubdirFile(
  resolvedPath: string,
  file: string
): Promise<string> {
  const target = resolve(resolvedPath, file)
  // Security: reject path traversal
  if (!target.startsWith(resolve(resolvedPath))) {
    throw new Error(`Path traversal rejected: "${file}"`)
  }
  return fs.readFile(target, "utf-8")
}
