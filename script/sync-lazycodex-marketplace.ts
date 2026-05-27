import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

const MARKETPLACE_SOURCE_PATH = join("packages", "omo-codex", "marketplace.json")
const PLUGIN_SOURCE_PATH = join("packages", "omo-codex", "plugin")
const MARKETPLACE_DESTINATION_PATH = join(".agents", "plugins", "marketplace.json")
const PLUGIN_DESTINATION_PATH = join("plugins", "omo")

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
