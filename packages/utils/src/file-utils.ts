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
