import { readFile, writeFile, rename } from "node:fs/promises"
import { join, isAbsolute, resolve, relative } from "node:path"
import { log } from "../../shared/logger"

export const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/")
}

export function extractAgentFromFrontmatter(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  const agentLine = fmMatch[1].match(/^agent:\s*(.+)$/m)
  return agentLine ? agentLine[1].trim() : null
}

export function isPathEscaping(expectedRoot: string, targetPath: string): boolean {
  const rel = relative(expectedRoot, targetPath)
  return rel.startsWith("..") || isAbsolute(rel)
}

export async function movePromptFile(
  promptFilePath: string,
  base: string,
  absArchiveDir: string,
  relArchiveDir: string,
): Promise<string | undefined> {
  try {
    const promptFilename = "council-prompt.md"
    const absPromptSrc = isAbsolute(promptFilePath) ? promptFilePath : resolve(base, promptFilePath)
    const expectedPromptRoot = join(base, ".sisyphus", "tmp")
    if (isPathEscaping(expectedPromptRoot, absPromptSrc)) {
      log("[council-finalize] Rejected prompt_file outside .sisyphus/tmp/", { promptFile: promptFilePath })
      return undefined
    }
    const absPromptDest = join(absArchiveDir, promptFilename)
    await rename(absPromptSrc, absPromptDest).catch(async () => {
      const content = await readFile(absPromptSrc, "utf-8")
      await writeFile(absPromptDest, content, "utf-8")
    })
    return toPosixPath(join(relArchiveDir, promptFilename))
  } catch (err) {
    log("[council-finalize] Failed to move prompt file", { promptFile: promptFilePath, error: String(err) })
    return undefined
  }
}
