import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { InstalledPlugin } from "./types"

export async function writeCachedMarketplaceManifest(input: {
  readonly marketplaceName: string
  readonly marketplaceRoot: string
  readonly plugins: readonly InstalledPlugin[]
}): Promise<void> {
  const marketplaceDir = join(input.marketplaceRoot, ".agents", "plugins")
  await mkdir(marketplaceDir, { recursive: true })
  for (const plugin of input.plugins) {
    const pluginPath = join(input.marketplaceRoot, plugin.name, plugin.version)
    if (!(await isDirectory(pluginPath))) throw new Error(`Cannot write cached marketplace manifest: ${pluginPath} does not exist`)
  }
  const manifestPath = join(marketplaceDir, "marketplace.json")
  const tempPath = join(marketplaceDir, `.marketplace.json.tmp-${process.pid}-${Date.now()}`)
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(
        {
          name: input.marketplaceName,
          plugins: input.plugins.map((plugin) => ({
            name: plugin.name,
            source: { source: "local", path: `./${plugin.name}/${plugin.version}` },
          })),
        },
        null,
        "\t",
      )}\n`,
    )
    await rename(tempPath, manifestPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
