import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { isPlainRecord } from "@oh-my-opencode/utils"

export interface ValidateLazycodexPluginBundleOptions {
  readonly requireRootCliRuntime?: boolean
}

export async function validateLazycodexPluginBundle(
  pluginRoot: string,
  options: ValidateLazycodexPluginBundleOptions = {},
): Promise<void> {
  const issues: string[] = []
  if (options.requireRootCliRuntime !== false) {
    await validateRootCliRuntime(pluginRoot, issues)
  }
  await validatePluginMcpManifests(pluginRoot, issues)
  await validatePluginHookCommands(pluginRoot, issues)
  await validatePluginManagedBins(pluginRoot, issues)
  if (issues.length > 0) {
    throw new Error(
      `lazycodex plugin bundle validation failed with ${issues.length} broken referenced target(s):\n${issues
        .map((issue) => ` - ${issue}`)
        .join("\n")}`,
    )
  }
}

async function validateRootCliRuntime(pluginRoot: string, issues: string[]): Promise<void> {
  await collectBundleFileIssue(pluginRoot, pluginRoot, "dist/cli/index.js", "missing root CLI runtime path", issues, {
    allowEscape: false,
  })
  await collectBundleFileIssue(pluginRoot, pluginRoot, "dist/cli-node/index.js", "missing root CLI runtime path", issues, {
    allowEscape: false,
  })
}

async function validatePluginMcpManifests(pluginRoot: string, issues: string[]): Promise<void> {
  for (const manifestPath of await findManifestPaths(pluginRoot, ".mcp.json")) {
    await validatePluginMcpManifest(pluginRoot, manifestPath, issues)
  }
}

async function validatePluginMcpManifest(pluginRoot: string, manifestPath: string, issues: string[]): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(parsed)) {
    throw new Error("invalid MCP manifest: expected object")
  }
  if (parsed.mcpServers === undefined) return
  if (!isPlainRecord(parsed.mcpServers)) {
    throw new Error("invalid MCP manifest: mcpServers must be object")
  }

  const manifestRoot = dirname(manifestPath)
  const isRootManifest = resolve(manifestRoot) === resolve(pluginRoot)
  for (const [serverName, server] of Object.entries(parsed.mcpServers)) {
    if (!isPlainRecord(server) || !Array.isArray(server.args)) continue
    for (const arg of server.args) {
      if (typeof arg !== "string" || !isPluginRuntimePathArg(arg)) continue
      await collectBundleFileIssue(pluginRoot, manifestRoot, arg, `missing MCP runtime path for ${serverName}`, issues, {
        // codex only reads the root .mcp.json; nested dev manifests may point outside the bundle
        allowEscape: !isRootManifest,
      })
    }
  }
}

async function validatePluginHookCommands(pluginRoot: string, issues: string[]): Promise<void> {
  const hookManifestPaths = await findHookManifestPaths(pluginRoot)
  for (const hookManifestPath of hookManifestPaths) {
    const parsed: unknown = JSON.parse(await readFile(hookManifestPath, "utf8"))
    const commands: string[] = []
    const hookPluginRoot = dirname(dirname(hookManifestPath))
    collectHookCommands(parsed, commands)
    for (const command of commands) {
      for (const relativePath of extractPluginRootPaths(command)) {
        const hookCommandRoot = relativePath.startsWith("components/") ? pluginRoot : hookPluginRoot
        await collectBundleFileIssue(pluginRoot, hookCommandRoot, relativePath, "missing hook command target", issues, {
          allowEscape: false,
        })
      }
    }
  }
}

// Codex links every component package.json "bin" as a managed bin; a missing target leaves the
// installer repairing a dangling bin on every session even when no hook references the CLI
// (lazycodex#108: omo-start-work-continuation, omo-ulw-loop, ulw, ulw-loop).
async function validatePluginManagedBins(pluginRoot: string, issues: string[]): Promise<void> {
  const componentsRoot = join(pluginRoot, "components")
  let entries
  try {
    entries = await readdir(componentsRoot, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error) return
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const binTarget of await readBinTargets(join(componentsRoot, entry.name, "package.json"))) {
      // Marketplace payload paths are POSIX; join() would emit backslashes on win32.
      const relativePath = join("components", entry.name, binTarget).split(sep).join("/")
      await collectBundleFileIssue(pluginRoot, pluginRoot, relativePath, "missing managed bin target", issues, {
        allowEscape: false,
      })
    }
  }
}

async function readBinTargets(manifestPath: string): Promise<string[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    if (error instanceof Error) return []
    return []
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.bin)) return []
  return Object.values(parsed.bin).filter((target): target is string => typeof target === "string")
}

async function findHookManifestPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths: string[] = []

  if (basename(root) === "hooks") {
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        paths.push(join(root, entry.name))
      }
    }
    return paths
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    if (entry.isDirectory()) {
      paths.push(...(await findHookManifestPaths(join(root, entry.name))))
    }
  }

  return paths
}

async function findManifestPaths(root: string, manifestName: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths: string[] = []

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await findManifestPaths(entryPath, manifestName)))
      continue
    }
    if (entry.isFile() && entry.name === manifestName) {
      paths.push(entryPath)
    }
  }

  return paths
}

function collectHookCommands(value: unknown, commands: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHookCommands(item, commands)
    }
    return
  }

  if (!isPlainRecord(value)) return
  if (value.type === "command") {
    if (typeof value.command === "string") commands.push(value.command)
    if (typeof value.commandWindows === "string") commands.push(value.commandWindows)
  }
  for (const child of Object.values(value)) {
    collectHookCommands(child, commands)
  }
}

function extractPluginRootPaths(command: string): string[] {
  const paths: string[] = []
  const pluginRootPathPattern = /\$\{PLUGIN_ROOT\}([\\/][^"'\s]+)/g
  let match = pluginRootPathPattern.exec(command)
  while (match) {
    const rawPath = match[1]
    if (rawPath) {
      paths.push(rawPath.split("\\").join("/").replace(/^\//, ""))
    }
    match = pluginRootPathPattern.exec(command)
  }
  return paths
}

function isPluginRuntimePathArg(arg: string): boolean {
  const normalized = arg.split("\\").join("/")
  return (
    normalized.endsWith(".js") &&
    normalized.includes("/dist/") &&
    (normalized.startsWith("./") ||
      normalized.startsWith("../") ||
      normalized.startsWith("components/") ||
      normalized.startsWith("/") || isAbsolute(arg))
  )
}

interface BundleFileCheckOptions {
  readonly allowEscape: boolean
}

async function collectBundleFileIssue(
  bundleRoot: string,
  baseRoot: string,
  relativePath: string,
  message: string,
  issues: string[],
  options: BundleFileCheckOptions,
): Promise<void> {
  const targetPath = resolve(baseRoot, relativePath)
  const bundleRootPath = resolve(bundleRoot)
  const bundleRootPrefix = bundleRootPath.endsWith(sep) ? bundleRootPath : `${bundleRootPath}${sep}`
  if (targetPath !== bundleRootPath && !targetPath.startsWith(bundleRootPrefix)) {
    if (options.allowEscape) return
    pushIssue(issues, `${message}: ${relativePath} escapes plugin root`)
    return
  }
  const size = await fileSize(targetPath)
  if (size === undefined) {
    pushIssue(issues, `${message}: ${relativePath}`)
    return
  }
  if (!options.allowEscape && !(await isRealPathWithinRoot(bundleRoot, targetPath))) {
    pushIssue(issues, `${message}: ${relativePath} escapes plugin root`)
    return
  }
  if (size === 0) {
    pushIssue(issues, `${message}: ${relativePath} is zero bytes`)
  }
}

function pushIssue(issues: string[], issue: string): void {
  if (issues.includes(issue)) return
  issues.push(issue)
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? stats.size : undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    return undefined
  }
}

async function isRealPathWithinRoot(root: string, target: string): Promise<boolean> {
  try {
    const rootPath = await realpath(root)
    const targetPath = await realpath(target)
    const rootPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
    return targetPath === rootPath || targetPath.startsWith(rootPrefix)
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
