#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	installCachedPlugin,
	linkCachedPluginBins,
	linkRootRuntimeBin,
	pruneMarketplaceCache,
	pruneMarketplacePluginCaches,
} from "./install/cache.mjs";
import { agentSourceRootsForInstall } from "./install/agent-source-roots.mjs";
import { capturePreservedAgentReasoning, capturePreservedAgentServiceTier, linkCachedPluginAgents } from "./install/agents.mjs";
import { writeCachedMarketplaceManifest } from "./install/cached-marketplace-manifest.mjs";
import { updateCodexConfig } from "./install/config.mjs";
import {
	emptyProjectLocalCodexCleanupResult,
	repairNearestProjectLocalCodexArtifacts,
} from "./install/project-local-cleanup.mjs";
import { trustedHookStatesForPlugin } from "./install/hook-trust.mjs";
import { defaultRunCommand } from "./install/process.mjs";
import {
	readMarketplace,
	readPluginManifest,
	resolvePluginSource,
	validatePathSegment,
} from "./install/marketplace.mjs";
import { prepareGitBashForInstall, resolveGitBashForCurrentProcess } from "./install/git-bash.mjs";
import { formatLazyCodexInstallHelp, parseLazyCodexInstallCliArgs } from "./install/cli-args.mjs";
import { runDelegatedOmoCommand } from "./install/delegated-command.mjs";
import {
	readDistributionManifest,
	resolveLazyCodexPluginVersion,
	stampLazyCodexPluginVersion,
	writeLazyCodexInstallSnapshot,
} from "./install/lazycodex-version-stamp.mjs";
import { shouldBuildSourcePackages } from "./install/source-package-build.mjs";
import { runLazyCodexManualUpdate } from "../plugin/scripts/auto-update.mjs";
export { nonEmptyEnvValue, resolveCodexInstallerBinDir } from "./install/bin-dir.mjs";
import { nonEmptyEnvValue, resolveCodexInstallerBinDir } from "./install/bin-dir.mjs";

export async function installMarketplaceLocally(options = {}) {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const env = options.env ?? process.env;
	const homeDir = resolve(options.homeDir ?? homedir());
	const codexHome = resolve(options.codexHome ?? nonEmptyEnvValue(env, "CODEX_HOME") ?? join(homeDir, ".codex"));
	const projectDirectory = resolve(options.projectDirectory ?? nonEmptyEnvValue(env, "OMO_CODEX_PROJECT") ?? process.cwd());
	const binDir = resolve(options.binDir ?? resolveCodexInstallerBinDir({ codexHome, env, homeDir }));
	const platform = options.platform ?? process.platform;
	const runCommand = options.runCommand ?? defaultRunCommand;
	const log = options.log ?? console.log;
	const buildSource = await shouldBuildSourcePackages(repoRoot);
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
	const distributionManifest = await readDistributionManifest(repoRoot);
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
		const version = resolveLazyCodexPluginVersion({ manifestVersion: manifest.version, marketplaceName: marketplace.name, pluginName: entry.name, distributionManifest });
		validatePathSegment(version, "plugin version");

		log(`Building ${entry.name}@${version}`);
		const plugin = await installCachedPlugin({
			buildSource,
			codexHome,
			marketplaceName: marketplace.name,
			name: entry.name,
			runCommand,
			sourcePath,
			version,
		});
		if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
			await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version });
			await writeLazyCodexInstallSnapshot({ pluginRoot: plugin.path, distributionManifest });
		}
		const binLinks = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path, platform });
		for (const link of binLinks) {
			log(`Linked ${link.name} -> ${link.target}`);
		}
		if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
			const runtimeLink = await linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform });
			if (runtimeLink !== null) log(`Linked ${runtimeLink.name} -> ${runtimeLink.target}`);
			else
				log(
					`Warning: skipped the omo runtime wrapper because ${join(repoRoot, "dist", "cli", "index.js")} is missing; omo sparkshell/ulw-loop commands will be unavailable until a package shipping dist/cli is installed`,
				);
		}
		pluginSources.push({ name: entry.name, sourcePath });
		installed.push(plugin);
	}

	const preservedReasoning = await capturePreservedAgentReasoning({ codexHome });
	const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome });
	const agentSourceRoots = await agentSourceRootsForInstall({ codexHome, marketplace, installed, pluginSources });
	for (const plugin of installed) {
		const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path;
		const agentLinks = await linkCachedPluginAgents({ codexHome, pluginRoot, platform, preservedReasoning, preservedServiceTier });
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
		platform,
		gitBashEnabled: platform === "win32" && gitBashResolution.found,
		trustedHookStates,
		agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
		autonomousPermissions: options.autonomousPermissions !== false,
	});
	const projectCleanup = await repairProjectLocalCodexArtifactsBestEffort({ startDirectory: projectDirectory, codexHome, log });
	for (const configCleanup of projectCleanup.configs) {
		if (!configCleanup.changed) continue;
		log(`Repaired project Codex config ${configCleanup.configPath} (backup: ${configCleanup.backupPath})`);
	}
	for (const artifact of projectCleanup.artifacts) {
		log(`Found project-local legacy artifact ${artifact.path}; left in place`);
	}

	for (const plugin of installed) {
		log(`Installed ${plugin.name}@${marketplace.name} -> ${plugin.path}`);
	}

	return { marketplaceName: marketplace.name, installed, gitBashPath: gitBashResolution.path, projectCleanup };
}

async function repairProjectLocalCodexArtifactsBestEffort({ startDirectory, codexHome, log }) {
	try {
		return await repairNearestProjectLocalCodexArtifacts({ startDirectory, codexHome });
	} catch (error) {
		log(`Skipped project-local Codex cleanup: ${formatUnknownError(error)}`);
		return emptyProjectLocalCodexCleanupResult();
	}
}

function formatUnknownError(error) {
	return error instanceof Error ? error.message : String(error);
}

function agentNameFromToml(fileName) {
	return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}

function legacyCacheMarketplaces(marketplaceName) {
	return marketplaceName === "sisyphuslabs" ? ["lazycodex", ["code", "yeongyu", "codex", "plugins"].join("-")] : [];
}

export function resolveDefaultRepoRoot() {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

async function main() {
	const parsed = parseLazyCodexInstallCliArgs(process.argv.slice(2));
	if (parsed.kind === "help") {
		console.log(formatLazyCodexInstallHelp());
		return;
	}
	if (parsed.kind === "version") {
		const packageJson = JSON.parse(await readFile(join(resolveDefaultRepoRoot(), "package.json"), "utf8"));
		const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
		console.log(`lazycodex-ai ${version}`);
		return;
	}
	if (parsed.kind === "command") {
		await runDelegatedOmoCommand(parsed, { cwd: process.cwd(), log: console.log, runCommand: defaultRunCommand });
		return;
	}
	if (parsed.kind === "update") {
		if (parsed.repoRoot) {
			if (parsed.dryRun) {
				console.log(`node ${fileURLToPath(import.meta.url)} install --repo-root=${parsed.repoRoot}`);
				return;
			}
			const result = await installMarketplaceLocally({
				repoRoot: resolve(parsed.repoRoot),
				autonomousPermissions: true,
			});
			console.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
			return;
		}
		const exitCode = await runLazyCodexManualUpdate({ env: process.env, dryRun: parsed.dryRun, log: console.log });
		process.exitCode = exitCode;
		return;
	}

	const repoRoot = parsed.repoRoot ? resolve(parsed.repoRoot) : resolveDefaultRepoRoot();
	const result = await installMarketplaceLocally({
		repoRoot,
		autonomousPermissions: parsed.autonomousPermissions,
	});
	console.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
}

function resolveEntrypointPath(path) {
	try {
		return realpathSync(resolve(path));
	} catch (error) {
		if (error instanceof Error) return resolve(path);
		throw error;
	}
}

function isEntrypointInvocation(invokedPath) {
	if (!invokedPath) return false;
	return resolveEntrypointPath(invokedPath) === resolveEntrypointPath(fileURLToPath(import.meta.url));
}

if (isEntrypointInvocation(process.argv[1] ?? "")) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
