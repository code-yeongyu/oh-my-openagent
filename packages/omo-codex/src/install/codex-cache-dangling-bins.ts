import { lstat, readFile, readdir, readlink, rm, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { isNodeErrorWithCode } from "./codex-cache-fs"

type LinkPlatform = NodeJS.Platform

export async function removeDanglingManagedComponentBins(
  binDir: string,
  platform: LinkPlatform,
  managedBinNames: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(binDir, { withFileTypes: true })
  for (const entry of entries) {
    const binName = managedBinNameForEntry(entry.name, platform)
    if (binName === null || !managedBinNames.has(binName)) continue
    const linkPath = join(binDir, entry.name)
    if (platform === "win32") {
      await removeDanglingGeneratedCommandShim(linkPath)
      continue
    }
    await removeDanglingManagedSymlink(linkPath)
  }
}

function managedBinNameForEntry(name: string, platform: LinkPlatform): string | null {
  if (platform === "win32") return name.endsWith(".cmd") ? name.slice(0, -4) : null
  return name
}

async function removeDanglingManagedSymlink(linkPath: string): Promise<void> {
  try {
    const linkStat = await lstat(linkPath)
    if (!linkStat.isSymbolicLink()) return
    const linkTarget = await readlink(linkPath)
    const target = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(linkPath), linkTarget)
    if (!(await isFileSystemEntry(target)) && isManagedComponentBinTarget(target)) await rm(linkPath, { force: true })
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return
    throw error
  }
}

async function removeDanglingGeneratedCommandShim(linkPath: string): Promise<void> {
  try {
    const linkStat = await lstat(linkPath)
    if (!linkStat.isFile()) return
    const content = await readFile(linkPath, "utf8")
    if (!content.includes(COMMAND_SHIM_MARKER)) return
    const target = extractCommandShimTarget(content)
    if (target !== null && !(await isFileSystemEntry(target)) && isManagedComponentBinTarget(target)) await rm(linkPath, { force: true })
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return
    throw error
  }
}

async function isFileSystemEntry(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

function extractCommandShimTarget(content: string): string | null {
  const match = /"([^"\r\n]+components[\\/][^"\r\n]+[\\/]dist[\\/]cli\.js)" %\*/.exec(content)
  return match?.[1] ?? null
}

function isManagedComponentBinTarget(target: string): boolean {
  const parts = target.split(/[\\/]+/)
  const suffix = parts.slice(-4)
  return (
    suffix[0] === "components" &&
    suffix[2] === "dist" &&
    suffix[3] === "cli.js" &&
    (hasOmoPluginCachePrefix(parts, parts.length - 4) || hasOmoCodexPluginPrefix(parts, parts.length - 4))
  )
}

function hasOmoPluginCachePrefix(parts: readonly string[], endExclusive: number): boolean {
  for (let index = 0; index < endExclusive - 4; index += 1) {
    if (
      parts[index] === "plugins" &&
      parts[index + 1] === "cache" &&
      parts[index + 2] === "sisyphuslabs" &&
      parts[index + 3] === "omo"
    ) {
      return index + 4 < endExclusive
    }
  }
  return false
}

function hasOmoCodexPluginPrefix(parts: readonly string[], endExclusive: number): boolean {
  for (let index = 0; index <= endExclusive - 3; index += 1) {
    if (parts[index] === "packages" && parts[index + 1] === "omo-codex" && parts[index + 2] === "plugin") return true
  }
  return false
}
