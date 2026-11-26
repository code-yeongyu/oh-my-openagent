import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { lstat } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"

/**
 * Copies a directory tree with the same result as `cp(source, target, { recursive: true, filter })`:
 * files keep their mode and overwrite an existing file, a directory it creates takes the source
 * directory's mode, a symlink is recreated (replacing an existing link) pointing at its resolved
 * absolute target, and a directory over an existing non-directory or any other file type is refused.
 *
 * It is synchronous on purpose. Bun's node:fs `cp` stats every entry several times and chmods each
 * file through the async thread pool; on the ~1,600-file plugin tree that cost 12-14 s per copy on a
 * loaded machine and pushed one install past 20 s on a starved CPU (#14000). The installer has nothing
 * to overlap with these copies, and a sync walk holds one file pair open at a time.
 */
export function copyDirectoryTree(
  source: string,
  target: string,
  include: (sourcePath: string) => boolean = () => true,
): void {
  mkdirSync(dirname(target), { recursive: true })
  copyDirectoryEntries(source, target, include)
}

function copyDirectoryEntries(source: string, target: string, include: (sourcePath: string) => boolean): void {
  if (createDirectory(target)) chmodSync(target, lstatSync(source).mode & 0o7777)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    if (!include(sourcePath)) continue
    const targetPath = join(target, entry.name)
    if (entry.isDirectory()) copyDirectoryEntries(sourcePath, targetPath, include)
    else if (entry.isFile()) copyFile(sourcePath, targetPath)
    else if (entry.isSymbolicLink()) copySymlink(sourcePath, targetPath)
    else throw new Error(`cannot copy ${sourcePath}: not a file, directory, or symlink`)
  }
}

function createDirectory(path: string): boolean {
  try {
    mkdirSync(path)
    return true
  } catch (error) {
    if (!isNodeErrorWithCode(error) || error.code !== "EEXIST") throw error
    if (!lstatSync(path).isDirectory()) throw new Error(`cannot copy a directory to non-directory ${path}`)
    return false
  }
}

// cp overwrites an existing read-only file; copyFileSync cannot open one for writing, so replace it.
function copyFile(sourcePath: string, targetPath: string): void {
  try {
    copyFileSync(sourcePath, targetPath)
  } catch (error) {
    if (!isNodeErrorWithCode(error) || (error.code !== "EACCES" && error.code !== "EPERM")) throw error
    if (!lstatSync(targetPath).isFile()) throw error
    unlinkSync(targetPath)
    copyFileSync(sourcePath, targetPath)
  }
}

function copySymlink(sourcePath: string, targetPath: string): void {
  const link = readlinkSync(sourcePath)
  const resolvedLink = isAbsolute(link) ? link : resolve(dirname(sourcePath), link)
  try {
    symlinkSync(resolvedLink, targetPath)
  } catch (error) {
    if (!isNodeErrorWithCode(error) || error.code !== "EEXIST" || !lstatSync(targetPath).isSymbolicLink()) throw error
    unlinkSync(targetPath)
    symlinkSync(resolvedLink, targetPath)
  }
}

export async function fileExistsStrict(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
