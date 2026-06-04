import { writeInstalledMarketplaceSnapshot } from "./snapshot.mjs";

export async function agentSourceRootsForInstall({ codexHome, marketplace, installed, pluginSources }) {
	if (marketplace.name !== "sisyphuslabs") {
		return new Map(installed.map((plugin) => [plugin.name, plugin.path]));
	}
	const snapshotPlugins = await writeInstalledMarketplaceSnapshot({
		codexHome,
		marketplace,
		plugins: pluginSources,
	});
	return new Map(snapshotPlugins.map((plugin) => [plugin.name, plugin.path]));
}
