#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	installCachedPlugin,
	linkCachedPluginBins,
	pruneMarketplaceCache,
	pruneMarketplacePluginCaches,
} from "./install/cache.mjs";
import { updateCodexConfig } from "./install/config.mjs";
import { trustedHookStatesForPlugin } from "./install/hook-trust.mjs";
import { defaultRunCommand } from "./install/process.mjs";
import {
	readMarketplace,
	readPluginManifest,
	resolvePluginSource,
	validatePathSegment,
} from "./install/marketplace.mjs";

const SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"];

export async function installMarketplaceLocally(options = {}) {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
	const binDir = resolve(options.binDir ?? process.env.CODEX_LOCAL_BIN_DIR ?? join(homedir(), ".local", "bin"));
	const platform = options.platform ?? process.platform;
	const runCommand = options.runCommand ?? defaultRunCommand;
	const log = options.log ?? console.log;
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const marketplace = await readMarketplace(repoRoot, {
		marketplacePath: join(codexPackageRoot, "marketplace.json"),
	});
	const installed = [];

	for (const entry of marketplace.plugins) {
		const sourcePath = resolvePluginSource(codexPackageRoot, entry, { pathOverride: "./plugin" });
		const manifest = await readPluginManifest(sourcePath);
		if (manifest.name !== entry.name) {
			throw new Error(
				`plugin manifest name ${JSON.stringify(manifest.name)} does not match marketplace name ${JSON.stringify(entry.name)}`,
			);
		}
		const version = manifest.version ?? "local";
		validatePathSegment(version, "plugin version");

		log(`Building ${entry.name}@${version}`);
		const plugin = await installCachedPlugin({
			codexHome,
			marketplaceName: marketplace.name,
			name: entry.name,
			runCommand,
			sourcePath,
			version,
		});
		const binLinks = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path, platform });
		for (const link of binLinks) {
			log(`Linked ${link.name} -> ${link.target}`);
		}
		installed.push(plugin);
	}

	const pluginNames = marketplace.plugins.map((plugin) => plugin.name);
	const trustedHookStates = (
		await Promise.all(
			installed.map((plugin) =>
				trustedHookStatesForPlugin({
					marketplaceName: marketplace.name,
					pluginName: plugin.name,
					pluginRoot: plugin.path,
				}),
			),
		)
	).flat();
	await pruneMarketplaceCache({ codexHome, marketplaceName: marketplace.name, keepPluginNames: pluginNames });
	for (const legacyMarketplaceName of legacyCacheMarketplaces(marketplace.name)) {
		await pruneMarketplacePluginCaches({ codexHome, marketplaceName: legacyMarketplaceName, pluginNames });
	}
	await updateCodexConfig({
		configPath: join(codexHome, "config.toml"),
		repoRoot: codexPackageRoot,
		marketplaceName: marketplace.name,
		pluginNames,
		trustedHookStates,
	});

	for (const plugin of installed) {
		log(`Installed ${plugin.name}@${marketplace.name} -> ${plugin.path}`);
	}

	return { marketplaceName: marketplace.name, installed };
}

function legacyCacheMarketplaces(marketplaceName) {
	return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_CACHE_MARKETPLACES : [];
}

async function main() {
	const repoRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
	const result = await installMarketplaceLocally({ repoRoot });
	console.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
