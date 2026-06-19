import { lstatSync, realpathSync } from "fs"
import { promises as fs } from "fs"
import { access, lstat } from "fs/promises"

function normalizeDarwinRealpath(filePath: string): string {
  return filePath.startsWith("/private/var/") ? filePath.slice("/private".length) : filePath
}

export function isMarkdownFile(entry: { name: string; isFile: () => boolean }): boolean {
	return !entry.name.startsWith(".") && entry.name.endsWith(".md") && entry.isFile()
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

export async function fileExistsStrict(filePath: string): Promise<boolean> {
	try {
		await lstat(filePath)
		return true
	} catch (error) {
		if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
		throw error
	}
}

export function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath, { throwIfNoEntry: false })?.isSymbolicLink() ?? false
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return false
  }
}

export function resolveSymlink(filePath: string): string {
  try {
    return normalizeDarwinRealpath(realpathSync.native(filePath))
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return filePath
  }
}

export async function resolveSymlinkAsync(filePath: string): Promise<string> {
  try {
    return normalizeDarwinRealpath(await fs.realpath(filePath))
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return filePath
	}
}

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error
}
