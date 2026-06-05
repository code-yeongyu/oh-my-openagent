import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, sep } from "node:path"
import { copyBundledMcpRuntimeDists, resolveBundledMcpRuntimeArg } from "./codex-cache-bundled-mcps"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { removeLegacyCodexComponentBins } from "./codex-cache-legacy-bins"
import { rewriteCachedPackageLocalFileDependencies } from "./codex-cache-local-dependencies"
import { resolveCachedRuntimePath } from "./codex-cache-paths"
import type { InstalledPlugin, RunCommand } from "./types"

type LinkPlatform = NodeJS.Platform

export async function installCachedPlugin(input: {
  readonly buildSource?: boolean
  readonly codexHome: string
  readonly marketplaceName: string
  readonly name: string
  readonly sourcePath: string
  readonly version: string
  readonly runCommand: RunCommand
}): Promise<InstalledPlugin> {
  if (input.buildSource !== false) {
    await maybeRunNpmInstall(input.sourcePath, input.runCommand)
    await maybeRunNpmBuild(input.sourcePath, input.runCommand)
  }

  const targetPath = join(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version)
  const tempPath = createTempSiblingPath(targetPath)
  await rm(tempPath, { recursive: true, force: true })
  try {
    await copyDirectory(input.sourcePath, tempPath)
    await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath)
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath })
    await maybeRunNpmInstall(tempPath, input.runCommand, ["install", "--omit=dev"])
    await rewriteCachedMcpManifest(tempPath, input.sourcePath)
    await rewriteCachedManifestRoot(tempPath, tempPath, targetPath)
    await rm(targetPath, { recursive: true, force: true })
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true })
    throw error
  }
  return { name: input.name, version: input.version, path: targetPath }
}

export async function pruneMarketplaceCache(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly keepPluginNames: readonly string[]
}): Promise<void> {
  const cacheRoot = join(input.codexHome, "plugins", "cache", input.marketplaceName)
  if (!(await exists(cacheRoot))) return
  const keep = new Set(input.keepPluginNames)
  const entries = await readdir(cacheRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue
    await rm(join(cacheRoot, entry.name), { recursive: true, force: true })
  }
}

export async function pruneMarketplacePluginCaches(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly pluginNames: readonly string[]
}): Promise<void> {
  const cacheRoot = join(input.codexHome, "plugins", "cache", input.marketplaceName)
  if (!(await exists(cacheRoot))) return
  for (const pluginName of input.pluginNames) {
    await rm(join(cacheRoot, pluginName), { recursive: true, force: true })
  }
  if ((await readdir(cacheRoot)).length === 0) {
    await rm(cacheRoot, { recursive: true, force: true })
  }
}

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

export async function rewriteCachedMcpManifest(pluginRoot: string, sourceRoot = pluginRoot): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await exists(manifestPath))) return
  const raw = await readFile(manifestPath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return
  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isRecord(server)) continue
    if (server.cwd === "." || server.cwd === "./") {
      delete server.cwd
      changed = true
    }
    const currentArgs = server.args
    if (!Array.isArray(currentArgs)) continue
    const nextArgs = currentArgs.map((arg) => {
      if (typeof arg !== "string") return arg
      const bundledMcpRuntimeArg = resolveBundledMcpRuntimeArg(pluginRoot, arg)
      if (bundledMcpRuntimeArg !== null) return bundledMcpRuntimeArg
      if (arg.startsWith("./") || arg.startsWith("../")) return resolveCachedRuntimePath(pluginRoot, sourceRoot, arg)
      return arg
    })
    if (nextArgs.some((value, index) => value !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}

async function rewriteCachedManifestRoot(pluginRoot: string, fromRoot: string, toRoot: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await exists(manifestPath))) return
  const raw = await readFile(manifestPath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return
  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isRecord(server)) continue
    const currentArgs = server.args
    if (!Array.isArray(currentArgs)) continue
    const nextArgs = currentArgs.map((arg) => {
      if (typeof arg !== "string") return arg
      if (arg === fromRoot) return toRoot
      const prefix = `${fromRoot}${sep}`
      if (!arg.startsWith(prefix)) return arg
      return `${toRoot}${arg.slice(fromRoot.length)}`
    })
    if (nextArgs.some((value, index) => value !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}

async function maybeRunNpmInstall(cwd: string, runCommand: RunCommand, args: readonly string[] = ["install"]): Promise<void> {
  if (!(await exists(join(cwd, "package.json")))) return
  await runCommand("npm", args, { cwd })
}

async function maybeRunNpmBuild(cwd: string, runCommand: RunCommand): Promise<void> {
  if (!(await exists(join(cwd, "package.json")))) return
  const packageJson: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"))
  if (!isRecord(packageJson)) return
  const scripts = packageJson.scripts
  if (!isRecord(scripts) || typeof scripts.build !== "string") return
  await runCommand("npm", ["run", "build"], { cwd })
}

function createTempSiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.tmp-${basename(targetPath)}-${process.pid}-${Date.now()}`)
}

async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath, { recursive: true, filter: (source) => shouldCopyPluginPath(source, sourcePath) })
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
    links.push({ name: basename(packageName), target: join(packageRoot, packageBin) })
    return
  }
  if (!isRecord(packageBin)) return
  for (const [name, target] of Object.entries(packageBin)) {
    if (typeof target !== "string") continue
    links.push({ name, target: join(packageRoot, target) })
  }
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

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative === "") return true
  const parts = relative.split(sep)
  if (parts[parts.length - 1] === "package-lock.json") return false
  return !parts.some((part) => part === ".git" || part === "node_modules")
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
