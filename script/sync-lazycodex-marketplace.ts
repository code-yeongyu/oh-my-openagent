import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { validateLazycodexPluginBundle } from "./lazycodex-marketplace-validation"

const MARKETPLACE_SOURCE_PATH = join("packages", "omo-codex", "marketplace.json")
const PLUGIN_SOURCE_PATH = join("packages", "omo-codex", "plugin")
const AST_GREP_MCP_DIST_SOURCE_PATH = join("packages", "ast-grep-mcp", "dist")
const LSP_TOOLS_MCP_DIST_SOURCE_PATH = join("packages", "lsp-tools-mcp", "dist")
const MARKETPLACE_DESTINATION_PATH = join(".agents", "plugins", "marketplace.json")
const PLUGIN_DESTINATION_PATH = join("plugins", "omo")
const AST_GREP_MCP_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "ast-grep-mcp", "dist")
const LSP_TOOLS_MCP_DIST_DESTINATION_PATH = join(PLUGIN_DESTINATION_PATH, "components", "lsp-tools-mcp", "dist")
const AST_GREP_MCP_SOURCE_ARG = "../../ast-grep-mcp/dist/cli.js"
const AST_GREP_MCP_PLUGIN_ARG = "./components/ast-grep-mcp/dist/cli.js"
const LSP_TOOLS_MCP_SOURCE_ARG = "../../lsp-tools-mcp/dist/cli.js"
const LSP_TOOLS_MCP_PLUGIN_ARG = "./components/lsp-tools-mcp/dist/cli.js"

const BUNDLED_MCP_DISTS = [
  {
    label: "ast-grep MCP",
    sourcePath: AST_GREP_MCP_DIST_SOURCE_PATH,
    destinationPath: AST_GREP_MCP_DIST_DESTINATION_PATH,
  },
  {
    label: "LSP MCP",
    sourcePath: LSP_TOOLS_MCP_DIST_SOURCE_PATH,
    destinationPath: LSP_TOOLS_MCP_DIST_DESTINATION_PATH,
  },
] as const

const MCP_ARG_REWRITES = [
  [AST_GREP_MCP_SOURCE_ARG, AST_GREP_MCP_PLUGIN_ARG],
  [LSP_TOOLS_MCP_SOURCE_ARG, LSP_TOOLS_MCP_PLUGIN_ARG],
] as const

export interface SyncLazycodexMarketplaceInput {
  readonly sourceRoot: string
  readonly lazycodexRoot: string
}

interface MarketplaceManifest {
  readonly name: string
}

interface PluginManifest {
  readonly name: string
  readonly version?: string
}

export async function syncLazycodexMarketplace(input: SyncLazycodexMarketplaceInput): Promise<void> {
  const sourceRoot = resolve(input.sourceRoot)
  const lazycodexRoot = resolve(input.lazycodexRoot)
  const marketplacePath = join(sourceRoot, MARKETPLACE_SOURCE_PATH)
  const pluginRoot = join(sourceRoot, PLUGIN_SOURCE_PATH)
  const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json")

  const marketplace = await readMarketplaceManifest(marketplacePath)
  if (marketplace.name !== "sisyphuslabs") {
    throw new Error(`Sisyphus Labs marketplace manifest must be named sisyphuslabs, got ${marketplace.name}`)
  }

  const pluginManifest = await readPluginManifest(pluginManifestPath)
  if (pluginManifest.name !== "omo") {
    throw new Error(`Sisyphus Labs plugin manifest must be named omo, got ${pluginManifest.name}`)
  }

  const destinationMarketplacePath = join(lazycodexRoot, MARKETPLACE_DESTINATION_PATH)
  await mkdir(dirname(destinationMarketplacePath), { recursive: true })
  await writeFile(destinationMarketplacePath, await readFile(marketplacePath, "utf8"))

  const destinationPluginRoot = join(lazycodexRoot, PLUGIN_DESTINATION_PATH)
  await rm(destinationPluginRoot, { recursive: true, force: true })
  await mkdir(dirname(destinationPluginRoot), { recursive: true })
  await cp(pluginRoot, destinationPluginRoot, {
    recursive: true,
    filter: (path) => shouldCopyPluginPath(path, pluginRoot),
  })
  await copyBundledMcpDists(sourceRoot, lazycodexRoot)
  await rewritePluginMcpManifest(destinationPluginRoot)
  await validateLazycodexPluginBundle(destinationPluginRoot)
}

async function readMarketplaceManifest(path: string): Promise<MarketplaceManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return { name: parsed.name }
  }
  throw new Error("invalid Sisyphus Labs marketplace manifest")
}

async function readPluginManifest(path: string): Promise<PluginManifest> {
  if (!(await isFile(path))) {
    throw new Error(`missing Codex plugin manifest at ${path}`)
  }
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return {
      name: parsed.name,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    }
  }
  throw new Error("invalid Codex plugin manifest")
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

async function copyBundledMcpDists(sourceRoot: string, lazycodexRoot: string): Promise<void> {
  for (const mcpDist of BUNDLED_MCP_DISTS) {
    await copyBundledMcpDist(sourceRoot, lazycodexRoot, mcpDist)
  }
}

async function copyBundledMcpDist(
  sourceRoot: string,
  lazycodexRoot: string,
  mcpDist: (typeof BUNDLED_MCP_DISTS)[number],
): Promise<void> {
  const sourcePath = join(sourceRoot, mcpDist.sourcePath)
  if (!(await isDirectory(sourcePath))) {
    throw new Error(`missing built ${mcpDist.label} dist at ${sourcePath}`)
  }
  const destinationPath = join(lazycodexRoot, mcpDist.destinationPath)
  await mkdir(dirname(destinationPath), { recursive: true })
  await cp(sourcePath, destinationPath, { recursive: true })
}

async function rewritePluginMcpManifest(pluginRoot: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await isFile(manifestPath))) return
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return

  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isRecord(server) || !Array.isArray(server.args)) continue
    const currentArgs = server.args
    const nextArgs = currentArgs.map(rewriteMcpArg)
    if (nextArgs.some((arg, index) => arg !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}

function rewriteMcpArg(arg: unknown): unknown {
  if (typeof arg !== "string") return arg
  const rewrite = MCP_ARG_REWRITES.find(([sourceArg]) => sourceArg === arg)
  return rewrite?.[1] ?? arg
}

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative.length === 0) return true
  return !relative.split(sep).some((part) => part === ".git" || part === "node_modules")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

if (import.meta.main) {
  const sourceRoot = process.argv[2] ?? process.cwd()
  const lazycodexRoot = process.argv[3]
  if (lazycodexRoot === undefined) {
    throw new Error("Usage: bun run script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>")
  }
  await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
}
