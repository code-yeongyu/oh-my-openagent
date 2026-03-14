import { readFile, writeFile, rename, unlink } from "node:fs/promises"
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
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)
}

function resolvePromptTempFilePath(promptFilePath: string, base: string): string | undefined {
  const absPromptPath = isAbsolute(promptFilePath) ? promptFilePath : resolve(base, promptFilePath)
  const expectedPromptRoot = join(base, ".sisyphus", "tmp")

  if (isPathEscaping(expectedPromptRoot, absPromptPath)) {
    log("[council-finalize] Rejected prompt_file outside .sisyphus/tmp/", { promptFile: promptFilePath })
    return undefined
  }

  return absPromptPath
}

export async function cleanupPromptFile(promptFilePath: string, base: string): Promise<void> {
  const absPromptPath = resolvePromptTempFilePath(promptFilePath, base)
  if (!absPromptPath) return

  try {
    await unlink(absPromptPath)
    log("[council-finalize] Cleaned up prompt temp file", { promptFile: promptFilePath })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      log("[council-finalize] Failed to clean up prompt temp file", { promptFile: promptFilePath, error: String(err), code })
    }
  }
}

export async function movePromptFile(
  promptFilePath: string,
  base: string,
  absArchiveDir: string,
  relArchiveDir: string,
): Promise<string | undefined> {
  try {
    const promptFilename = "council-prompt.md"
    const absPromptSrc = resolvePromptTempFilePath(promptFilePath, base)
    if (!absPromptSrc) return undefined
    const absPromptDest = join(absArchiveDir, promptFilename)
    await rename(absPromptSrc, absPromptDest).catch(async (renameErr) => {
      log("[council-finalize] Rename failed, falling back to copy", { promptFile: promptFilePath, error: String(renameErr) })
      const content = await readFile(absPromptSrc, "utf-8")
      await writeFile(absPromptDest, content, "utf-8")
      await unlink(absPromptSrc).catch((err) => { log("[council-finalize] Failed to delete prompt source file", { error: String(err) }) })
    })
    return toPosixPath(join(relArchiveDir, promptFilename))
  } catch (err) {
    log("[council-finalize] Failed to move prompt file", { promptFile: promptFilePath, error: String(err) })
    return undefined
  }
}
