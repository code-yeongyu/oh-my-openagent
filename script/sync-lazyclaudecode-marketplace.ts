import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

const MARKETPLACE_SOURCE_PATH = join("packages", "omo-claude", "marketplace.json")
const PLUGIN_SOURCE_PATH = join("packages", "omo-claude", "plugin")
const MARKETPLACE_DESTINATION_PATH = join(".claude-plugin", "marketplace.json")
const PLUGIN_DESTINATION_PATH = join("plugins", "omo")

export interface SyncLazyclaudecodeMarketplaceInput {
  readonly sourceRoot: string
  readonly lazyclaudecodeRoot: string
}

interface MarketplaceManifest {
  readonly name: string
}

interface PluginManifest {
  readonly name: string
  readonly version?: string
}

export async function syncLazyclaudecodeMarketplace(input: SyncLazyclaudecodeMarketplaceInput): Promise<void> {
  const sourceRoot = resolve(input.sourceRoot)
  const lazyclaudecodeRoot = resolve(input.lazyclaudecodeRoot)
  const marketplacePath = join(sourceRoot, MARKETPLACE_SOURCE_PATH)
  const pluginRoot = join(sourceRoot, PLUGIN_SOURCE_PATH)
  const pluginManifestPath = join(pluginRoot, ".claude-plugin", "plugin.json")

  const marketplace = await readMarketplaceManifest(marketplacePath)
  if (marketplace.name !== "sisyphuslabs") {
    throw new Error(`Sisyphus Labs marketplace manifest must be named sisyphuslabs, got ${marketplace.name}`)
  }

  const pluginManifest = await readPluginManifest(pluginManifestPath)
  if (pluginManifest.name !== "omo") {
    throw new Error(`Sisyphus Labs plugin manifest must be named omo, got ${pluginManifest.name}`)
  }

  const destinationMarketplacePath = join(lazyclaudecodeRoot, MARKETPLACE_DESTINATION_PATH)
  await mkdir(dirname(destinationMarketplacePath), { recursive: true })
  await writeFile(destinationMarketplacePath, await readFile(marketplacePath, "utf8"))

  const destinationPluginRoot = join(lazyclaudecodeRoot, PLUGIN_DESTINATION_PATH)
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
    throw new Error(`missing Claude Code plugin manifest at .claude-plugin/plugin.json (${path})`)
  }
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return {
      name: parsed.name,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    }
  }
  throw new Error("invalid Claude Code plugin manifest")
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
  return !relative.split(sep).some(isExcludedPathPart)
}

function isExcludedPathPart(part: string): boolean {
  if (part === ".git" || part === "node_modules") return true
  if (part === "src" || part === "test") return true
  if (part === ".omo") return true
  return isTsconfigFile(part)
}

function isTsconfigFile(part: string): boolean {
  return part.startsWith("tsconfig") && part.endsWith(".json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

if (import.meta.main) {
  const sourceRoot = process.argv[2] ?? process.cwd()
  const lazyclaudecodeRoot = process.argv[3]
  if (lazyclaudecodeRoot === undefined) {
    throw new Error("Usage: bun run script/sync-lazyclaudecode-marketplace.ts <source-root> <lazyclaudecode-root>")
  }
  await syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })
}
