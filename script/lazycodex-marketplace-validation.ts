import { readFile, readdir, stat } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

export async function validateLazycodexPluginBundle(pluginRoot: string): Promise<void> {
  await validatePluginMcpManifest(pluginRoot)
  await validatePluginHookCommands(pluginRoot)
}

async function validatePluginMcpManifest(pluginRoot: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await isFile(manifestPath))) return

  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return

  for (const [serverName, server] of Object.entries(parsed.mcpServers)) {
    if (!isRecord(server) || !Array.isArray(server.args)) continue
    for (const arg of server.args) {
      if (typeof arg !== "string" || !isPluginRuntimePathArg(arg)) continue
      await validateRelativeBundleFile(pluginRoot, pluginRoot, arg, `missing MCP runtime path for ${serverName}`)
    }
  }
}

async function validatePluginHookCommands(pluginRoot: string): Promise<void> {
  const hookManifestPaths = await findHookManifestPaths(pluginRoot)
  for (const hookManifestPath of hookManifestPaths) {
    const parsed: unknown = JSON.parse(await readFile(hookManifestPath, "utf8"))
    const commands: string[] = []
    const hookPluginRoot = dirname(dirname(hookManifestPath))
    collectHookCommands(parsed, commands)
    for (const command of commands) {
      for (const relativePath of extractPluginRootPaths(command)) {
        const hookCommandRoot = relativePath.startsWith("components/") ? pluginRoot : hookPluginRoot
        await validateRelativeBundleFile(pluginRoot, hookCommandRoot, relativePath, "missing hook command target")
      }
    }
  }
}

async function findHookManifestPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths: string[] = []

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      paths.push(...await findHookManifestPaths(entryPath))
      continue
    }
    if (entry.isFile() && entry.name === "hooks.json" && root.endsWith(`${sep}hooks`)) {
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

  if (!isRecord(value)) return
  if (value.type === "command" && typeof value.command === "string") {
    commands.push(value.command)
  }
  for (const child of Object.values(value)) {
    collectHookCommands(child, commands)
  }
}

function extractPluginRootPaths(command: string): string[] {
  const paths: string[] = []
  const pluginRootPathPattern = /\$\{PLUGIN_ROOT\}\/([^"'\s]+)/g
  let match = pluginRootPathPattern.exec(command)
  while (match) {
    const relativePath = match[1]
    if (relativePath) {
      paths.push(relativePath)
    }
    match = pluginRootPathPattern.exec(command)
  }
  return paths
}

function isPluginRuntimePathArg(arg: string): boolean {
  return (arg.startsWith("./") || arg.startsWith("../")) && arg.endsWith("/dist/cli.js")
}

async function validateRelativeBundleFile(
  bundleRoot: string,
  baseRoot: string,
  relativePath: string,
  message: string,
): Promise<void> {
  const targetPath = resolve(baseRoot, relativePath)
  const bundleRootPath = resolve(bundleRoot)
  const bundleRootPrefix = bundleRootPath.endsWith(sep) ? bundleRootPath : `${bundleRootPath}${sep}`
  if (targetPath !== bundleRootPath && !targetPath.startsWith(bundleRootPrefix)) {
    throw new Error(`${message}: ${relativePath} escapes plugin root`)
  }
  if (!(await isFile(targetPath))) {
    throw new Error(`${message}: ${relativePath}`)
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
