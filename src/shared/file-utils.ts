import { lstatSync, realpathSync } from "fs"
import { promises as fs } from "fs"

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
    return realpathSync(filePath)
  } catch {
    return filePath
  }
}

export async function resolveSymlinkAsync(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath)
  } catch {
    return filePath
  }
}
