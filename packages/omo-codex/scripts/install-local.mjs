#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	installCachedPlugin,
	linkCachedPluginBins,
	pruneMarketplaceCache,
	pruneMarketplacePluginCaches,
} from "./install/cache.mjs";
import { linkCachedPluginAgents } from "./install/agents.mjs";
import { updateCodexConfig } from "./install/config.mjs";
import { trustedHookStatesForPlugin } from "./install/hook-trust.mjs";
import { defaultRunCommand } from "./install/process.mjs";
import { writeInstalledMarketplaceSnapshot } from "./install/snapshot.mjs";
import {
	readMarketplace,
	readPluginManifest,
	resolvePluginSource,
	validatePathSegment,
} from "./install/marketplace.mjs";
import { prepareGitBashForInstall, resolveGitBashForCurrentProcess } from "./install/git-bash.mjs";

const LEGACY_CODEX_PLUGIN_MARKETPLACE = ["code", "yeongyu", "codex", "plugins"].join("-");
const SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", LEGACY_CODEX_PLUGIN_MARKETPLACE];

export function resolveCodexInstallerBinDir(options = {}) {
	const homeDir = resolve(options.homeDir ?? homedir());
	const env = options.env ?? process.env;
	const explicitBinDir = nonEmptyEnvValue(env, "CODEX_LOCAL_BIN_DIR");
	if (explicitBinDir !== undefined) return explicitBinDir;

	const codexHome = resolve(options.codexHome ?? nonEmptyEnvValue(env, "CODEX_HOME") ?? join(homeDir, ".codex"));
	const defaultCodexHome = resolve(join(homeDir, ".codex"));
	return codexHome === defaultCodexHome ? join(homeDir, ".local", "bin") : join(codexHome, "bin");
}

export async function installMarketplaceLocally(options = {}) {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const env = options.env ?? process.env;
	const homeDir = resolve(options.homeDir ?? homedir());
	const codexHome = resolve(options.codexHome ?? nonEmptyEnvValue(env, "CODEX_HOME") ?? join(homeDir, ".codex"));
	const binDir = resolve(options.binDir ?? resolveCodexInstallerBinDir({ codexHome, env, homeDir }));
	const platform = options.platform ?? process.platform;
	const runCommand = options.runCommand ?? defaultRunCommand;
	const log = options.log ?? console.log;
	const gitBashResolution = await prepareGitBashForInstall({
		platform,
		env,
		cwd: repoRoot,
		runCommand,
		resolveGitBash: platform === "win32"
			? (options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess({ platform, env })))
			: undefined,
	});
	if (!gitBashResolution.found) {
		throw new Error(gitBashResolution.installHint);
	}
	const codexPackageRoot = join(repoRoot, "packages", "omo-codex");
	const marketplace = await readMarketplace(repoRoot, {
		marketplacePath: join(codexPackageRoot, "marketplace.json"),
	});
	const installed = [];
	const pluginSources = [];
	const agentConfigs = new Map();

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
		pluginSources.push({ name: entry.name, sourcePath });
		installed.push(plugin);
	}

	const agentSourceRoots = await agentSourceRootsForInstall({ codexHome, marketplace, installed, pluginSources });
	for (const plugin of installed) {
		const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path;
		const agentLinks = await linkCachedPluginAgents({ codexHome, pluginRoot, platform });
		for (const link of agentLinks) {
			log(`Linked agent ${link.name} -> ${link.target}`);
			const agentName = agentNameFromToml(link.name);
			agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` });
		}
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
	const marketplaceRoot = join(codexHome, "plugins", "cache", marketplace.name);
	await writeCachedMarketplaceManifest({
		marketplaceName: marketplace.name,
		marketplaceRoot,
		plugins: installed,
	});
	await updateCodexConfig({
		configPath: join(codexHome, "config.toml"),
		repoRoot: codexPackageRoot,
		marketplaceName: marketplace.name,
		marketplaceSource: { sourceType: "local", source: marketplaceRoot },
		pluginNames,
		trustedHookStates,
		agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
	});

	for (const plugin of installed) {
		log(`Installed ${plugin.name}@${marketplace.name} -> ${plugin.path}`);
	}

	return { marketplaceName: marketplace.name, installed, gitBashPath: gitBashResolution.path };
}

function agentNameFromToml(fileName) {
	return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}

async function agentSourceRootsForInstall({ codexHome, marketplace, installed, pluginSources }) {
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

async function writeCachedMarketplaceManifest({ marketplaceName, marketplaceRoot, plugins }) {
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

function nonEmptyEnvValue(env, key) {
	const value = env[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : value;
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
