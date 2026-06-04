import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeCachedMarketplaceManifest({ marketplaceName, marketplaceRoot, plugins }) {
	const marketplaceDir = join(marketplaceRoot, ".agents", "plugins");
	await mkdir(marketplaceDir, { recursive: true });
	await writeFile(
		join(marketplaceDir, "marketplace.json"),
		`${JSON.stringify(
			{
				name: marketplaceName,
				plugins: plugins.map((plugin) => ({
					name: plugin.name,
					source: { source: "local", path: `./${plugin.name}/${plugin.version}` },
				})),
			},
			null,
			"\t",
		)}\n`,
	);
}
