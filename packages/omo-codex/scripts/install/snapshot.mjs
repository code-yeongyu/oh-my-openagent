import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { rewriteCachedMcpManifest } from "./cache.mjs";

const INSTALLED_MARKETPLACES_DIR = ".tmp/marketplaces";

export async function writeInstalledMarketplaceSnapshot({ codexHome, marketplace, plugins }) {
	const marketplaceRoot = installedMarketplaceRoot(codexHome, marketplace.name);
	await mkdir(marketplaceRoot, { recursive: true });
	await writeMarketplaceManifest(marketplaceRoot, marketplace);

	const snapshotPlugins = [];
	for (const plugin of plugins) {
		snapshotPlugins.push(await writeSnapshotPlugin(marketplaceRoot, plugin));
	}
	return snapshotPlugins;
}

export function installedMarketplaceRoot(codexHome, marketplaceName) {
	return join(codexHome, INSTALLED_MARKETPLACES_DIR, marketplaceName);
}

async function writeMarketplaceManifest(marketplaceRoot, marketplace) {
	const manifestDir = join(marketplaceRoot, ".agents", "plugins");
	await mkdir(manifestDir, { recursive: true });
	const tempPath = join(manifestDir, `.marketplace-${process.pid}-${Date.now()}.json.tmp`);
	await writeFile(tempPath, `${JSON.stringify(marketplace, null, "\t")}\n`);
	await rename(tempPath, join(manifestDir, "marketplace.json"));
}

async function writeSnapshotPlugin(marketplaceRoot, plugin) {
	const pluginsDir = join(marketplaceRoot, "plugins");
	await mkdir(pluginsDir, { recursive: true });
	const targetPath = join(pluginsDir, plugin.name);
	const tempPath = join(pluginsDir, `.tmp-${plugin.name}-${process.pid}-${Date.now()}`);
	await rm(tempPath, { recursive: true, force: true });
	await cp(plugin.sourcePath, tempPath, {
		recursive: true,
		filter: (source) => shouldCopyMarketplaceSourcePath(source, plugin.sourcePath),
	});
	await rm(targetPath, { recursive: true, force: true });
	await rename(tempPath, targetPath);
	await rewriteCachedMcpManifest(targetPath, plugin.sourcePath);
	return { name: plugin.name, path: targetPath };
}

function shouldCopyMarketplaceSourcePath(path, root) {
	const relative = path === root ? "" : path.slice(root.length + sep.length);
	if (relative === "") return true;
	const parts = relative.split(sep);
	if (parts[parts.length - 1] === "package-lock.json") return false;
	return !parts.some((part) => part === ".git" || part === "node_modules");
}
