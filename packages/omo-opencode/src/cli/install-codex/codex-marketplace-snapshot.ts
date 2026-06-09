import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { copyBundledMcpRuntimeDists } from "./codex-cache-bundled-mcps"
import { rewriteCachedMcpManifest } from "./codex-cache"
import type { MarketplaceManifest } from "./types"

const INSTALLED_MARKETPLACES_DIR = ".tmp/marketplaces"

export interface MarketplaceSnapshotPluginSource {
  readonly name: string
  readonly sourcePath: string
}

export interface MarketplaceSnapshotPlugin {
  readonly name: string
  readonly path: string
}

export async function writeInstalledMarketplaceSnapshot(input: {
  readonly codexHome: string
  readonly marketplace: MarketplaceManifest
  readonly plugins: readonly MarketplaceSnapshotPluginSource[]
}): Promise<readonly MarketplaceSnapshotPlugin[]> {
  const marketplaceRoot = installedMarketplaceRoot(input.codexHome, input.marketplace.name)
  await mkdir(marketplaceRoot, { recursive: true })
  await writeMarketplaceManifest(marketplaceRoot, input.marketplace)

  const snapshotPlugins: MarketplaceSnapshotPlugin[] = []
  for (const plugin of input.plugins) {
    snapshotPlugins.push(await writeSnapshotPlugin(marketplaceRoot, plugin))
  }
  return snapshotPlugins
}

export function installedMarketplaceRoot(codexHome: string, marketplaceName: string): string {
  return join(codexHome, INSTALLED_MARKETPLACES_DIR, marketplaceName)
}

async function writeMarketplaceManifest(marketplaceRoot: string, marketplace: MarketplaceManifest): Promise<void> {
  const manifestDir = join(marketplaceRoot, ".agents", "plugins")
  await mkdir(manifestDir, { recursive: true })
  const tempPath = join(manifestDir, `.marketplace-${process.pid}-${Date.now()}.json.tmp`)
  await writeFile(tempPath, `${JSON.stringify(marketplace, null, "\t")}\n`)
  await rename(tempPath, join(manifestDir, "marketplace.json"))
}

async function writeSnapshotPlugin(
  marketplaceRoot: string,
  plugin: MarketplaceSnapshotPluginSource,
): Promise<MarketplaceSnapshotPlugin> {
  const pluginsDir = join(marketplaceRoot, "plugins")
  await mkdir(pluginsDir, { recursive: true })
  const targetPath = join(pluginsDir, plugin.name)
  const tempPath = join(pluginsDir, `.tmp-${plugin.name}-${process.pid}-${Date.now()}`)
  await rm(tempPath, { recursive: true, force: true })
  await cp(plugin.sourcePath, tempPath, {
    recursive: true,
    filter: (source) => shouldCopyMarketplaceSourcePath(source, plugin.sourcePath),
  })
  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath })
  await rm(targetPath, { recursive: true, force: true })
  await rename(tempPath, targetPath)
  await rewriteCachedMcpManifest(targetPath, plugin.sourcePath)
  return { name: plugin.name, path: targetPath }
}

function shouldCopyMarketplaceSourcePath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative === "") return true
  const parts = relative.split(sep)
  return !parts.some((part) => part === ".git" || part === "node_modules")
}
