import { readFile, writeFile, rename, unlink } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, join, isAbsolute, resolve, relative } from "node:path"
import { resolveSymlink } from "../../shared/file-utils"
import { log } from "../../shared/logger"
import { COUNCIL_DEFAULTS } from "../../agents/athena"

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

export function absoluteToRelativePath(absolutePath: string): string {
  // Convert absolute paths to relative by removing leading directory structure
  // Pattern: /Users/username/.../.sisyphus/ -> .sisyphus/
  const match = absolutePath.match(/\/\.sisyphus\//)
  if (match) {
    return absolutePath.substring(match.index! + 1)
  }
  return absolutePath
}

export function extractAgentFromFrontmatter(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  const agentLine = fmMatch[1].match(/^agent:\s*(.+)$/m)
  return agentLine ? agentLine[1].trim() : null
}

function normalizeCanonicalPath(pathValue: string): string {
  return pathValue.startsWith("/private/var/") ? pathValue.slice("/private".length) : pathValue
}

function toCanonicalPath(absolutePath: string): string {
  try {
    return normalizeCanonicalPath(realpathSync.native(absolutePath))
  } catch (error) {
    const pathError = error as NodeJS.ErrnoException
    if (pathError.code !== "ENOENT") {
      return normalizeCanonicalPath(resolveSymlink(absolutePath))
    }

    const absoluteDir = dirname(absolutePath)
    if (absoluteDir === absolutePath) {
      return resolve(absolutePath)
    }

    if (existsSync(absoluteDir)) {
      return join(normalizeCanonicalPath(resolveSymlink(absoluteDir)), basename(absolutePath))
    }

    return join(toCanonicalPath(absoluteDir), basename(absolutePath))
  }
}

export function isPathEscaping(expectedRoot: string, targetPath: string): boolean {
  const rel = relative(toCanonicalPath(expectedRoot), toCanonicalPath(targetPath))
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)
}

function resolvePromptTempFilePath(promptFilePath: string, base: string): string | undefined {
  const absPromptPath = isAbsolute(promptFilePath) ? promptFilePath : resolve(base, promptFilePath)
  const expectedPromptRoot = join(base, ".sisyphus", "tmp")

  if (isPathEscaping(expectedPromptRoot, absPromptPath)) {
    log("[council-finalize] Rejected prompt_file outside .sisyphus/tmp/", { promptFile: promptFilePath }, true)
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
      log("[council-finalize] Failed to clean up prompt temp file", { promptFile: promptFilePath, error: String(err), code }, true)
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
      log("[council-finalize] Rename failed, falling back to copy", { promptFile: promptFilePath, error: String(renameErr) }, false)
      const content = await readFile(absPromptSrc, "utf-8")
      await writeFile(absPromptDest, content, "utf-8")
      await unlink(absPromptSrc).catch((err) => { log("[council-finalize] Failed to delete prompt source file", { error: String(err) }, true) })
    })
    return toPosixPath(join(relArchiveDir, promptFilename))
  } catch (err) {
    log("[council-finalize] Failed to move prompt file", { promptFile: promptFilePath, error: String(err) }, true)
    return undefined
  }
}

export function generateUniqueArchiveName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) {
    return baseName
  }

  let counter = 1
  let newName = `${baseName}-${counter}`
  while (existingNames.includes(newName)) {
    counter++
    newName = `${baseName}-${counter}`
  }
  return newName
}

export function validateArchiveName(name: string): string {
  const max = COUNCIL_DEFAULTS.ARCHIVE_NAME_MAX_LENGTH
  if (name.length > max) {
    throw new Error(`Archive name too long: ${name.length} > ${max}`)
  }
  return name
}
