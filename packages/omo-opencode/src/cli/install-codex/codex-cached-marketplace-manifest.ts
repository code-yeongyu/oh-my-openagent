import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { InstalledPlugin } from "./types"

export async function writeCachedMarketplaceManifest(input: {
  readonly marketplaceName: string
  readonly marketplaceRoot: string
  readonly plugins: readonly InstalledPlugin[]
}): Promise<void> {
  const marketplaceDir = join(input.marketplaceRoot, ".agents", "plugins")
  await mkdir(marketplaceDir, { recursive: true })
  await writeFile(
    join(marketplaceDir, "marketplace.json"),
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
}
