import { lstatSync, realpathSync } from "fs"
import { promises as fs } from "fs"

function normalizeDarwinRealpath(filePath: string): string {
  return filePath.startsWith("/private/var/") ? filePath.slice("/private".length) : filePath
}

export function isMarkdownFile(entry: { name: string; isFile: () => boolean }): boolean {
  return !entry.name.startsWith(".") && entry.name.endsWith(".md") && entry.isFile()
}

export function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath, { throwIfNoEntry: false })?.isSymbolicLink() ?? false
  } catch {
    return false
  }
}

export function resolveSymlink(filePath: string): string {
  try {
    return normalizeDarwinRealpath(realpathSync(filePath))
  } catch {
    return filePath
  }
}

export async function resolveSymlinkAsync(filePath: string): Promise<string> {
  try {
    return normalizeDarwinRealpath(await fs.realpath(filePath))
  } catch {
    return filePath
  }
}

export async function readFileWithContext(filePath: string, readContext: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch (error) {
    const pathError = error as NodeJS.ErrnoException
    const baseMessage = `${pathError.code === "ENOENT" ? "File not found" : "Failed to read file"}: ${filePath} (attempted read from ${readContext})`
    const message = pathError.code === "ENOENT" || !pathError.message
      ? baseMessage
      : `${baseMessage}: ${pathError.message}`

    throw new Error(message, { cause: error })
  }
}
