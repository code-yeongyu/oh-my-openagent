import { lstatSync, readlinkSync } from "fs"
import { promises as fs } from "fs"
import { resolve } from "path"

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
    const stats = lstatSync(filePath, { throwIfNoEntry: false })
    if (stats?.isSymbolicLink()) {
      return resolve(filePath, "..", readlinkSync(filePath))
    }
    return filePath
  } catch {
    return filePath
  }
}

export async function resolveSymlinkAsync(filePath: string): Promise<string> {
  try {
    const stats = await fs.lstat(filePath)
    if (stats.isSymbolicLink()) {
      const linkTarget = await fs.readlink(filePath)
      return resolve(filePath, "..", linkTarget)
    }
    return filePath
  } catch {
    return filePath
  }
}
