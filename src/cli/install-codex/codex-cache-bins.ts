import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { isNodeErrorWithCode, isRecord } from "./codex-cache-fs"
import { removeLegacyCodexComponentBins } from "./codex-cache-legacy-bins"

type LinkPlatform = NodeJS.Platform

export async function linkCachedPluginBins(input: {
  readonly binDir: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
}): Promise<readonly { name: string; path: string; target: string }[]> {
  const binLinks = await discoverPackageBins(input.pluginRoot)
  const platform = input.platform ?? process.platform
  await mkdir(input.binDir, { recursive: true })
  await removeLegacyCodexComponentBins(input.binDir, platform)
  const linked: Array<{ name: string; path: string; target: string }> = []
  for (const link of binLinks) {
    const linkPath = await linkCachedPluginBin(input.binDir, link, platform)
    linked.push({ name: link.name, path: linkPath, target: link.target })
  }
  return linked
}

async function linkCachedPluginBin(
  binDir: string,
  link: { readonly name: string; readonly target: string },
  platform: LinkPlatform,
): Promise<string> {
  if (platform === "win32") {
    const linkPath = join(binDir, `${link.name}.cmd`)
    await replaceCommandShim(linkPath, link.target)
    return linkPath
  }

  const linkPath = join(binDir, link.name)
  await replaceSymlink(linkPath, link.target)
  return linkPath
}

async function discoverPackageBins(root: string): Promise<readonly { name: string; target: string }[]> {
  const links: Array<{ name: string; target: string }> = []
  await collectPackageBins(root, root, links)
  return links
}

async function collectPackageBins(directory: string, root: string, links: Array<{ name: string; target: string }>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    await appendPackageBinLinks(join(directory, "package.json"), directory, links)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
    const childPath = join(directory, entry.name)
    if (!childPath.startsWith(root)) continue
    await collectPackageBins(childPath, root, links)
  }
}

async function appendPackageBinLinks(packageJsonPath: string, packageRoot: string, links: Array<{ name: string; target: string }>): Promise<void> {
  const packageJson: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"))
  if (!isRecord(packageJson)) return
  const packageName = packageJson.name
  const packageBin = packageJson.bin
  if (typeof packageBin === "string" && typeof packageName === "string") {
    links.push({ name: assertSafeCommandName(basename(packageName)), target: resolvePackageBinTarget(packageRoot, packageBin) })
    return
  }
  if (!isRecord(packageBin)) return
  for (const [name, target] of Object.entries(packageBin)) {
    if (typeof target !== "string") continue
    links.push({ name: assertSafeCommandName(name), target: resolvePackageBinTarget(packageRoot, target) })
  }
}

function assertSafeCommandName(name: string): string {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`Invalid package bin command name: ${name}`)
  }
  return name
}

function resolvePackageBinTarget(packageRoot: string, target: string): string {
  if (target.includes("\0")) throw new Error("Package bin target must stay inside package root")
  const root = resolve(packageRoot)
  const resolvedTarget = resolve(root, target)
  const relativeTarget = relative(root, resolvedTarget)
  if (relativeTarget === "" || (relativeTarget !== ".." && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute(relativeTarget))) {
    return resolvedTarget
  }
  throw new Error("Package bin target must stay inside package root")
}

async function replaceSymlink(linkPath: string, targetPath: string): Promise<void> {
  if (await existingNonSymlink(linkPath)) throw new Error(`${linkPath} already exists and is not a symlink`)
  await rm(linkPath, { force: true })
  await symlink(targetPath, linkPath)
}

async function replaceCommandShim(linkPath: string, targetPath: string): Promise<void> {
  if (await existingNonShim(linkPath)) throw new Error(`${linkPath} already exists and is not a command shim`)
  await writeFile(linkPath, `@echo off\r\n${COMMAND_SHIM_MARKER}\r\nnode "${targetPath}" %*\r\n`)
}

async function existingNonShim(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) return true
    const content = await readFile(path, "utf8")
    if (content.includes(COMMAND_SHIM_MARKER)) return false
    throw new Error(`${path} already exists and is not a generated command shim`)
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

async function existingNonSymlink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) return true
    await readlink(path)
    return false
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}
