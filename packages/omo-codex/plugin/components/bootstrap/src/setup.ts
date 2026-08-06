import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// These relative imports resolve at BUILD time in the monorepo; esbuild
// inlines the installer source modules into dist/cli.js so PLUGIN_ROOT ships
// nothing beyond the bundle.
import {
	capturePreservedAgentReasoning,
	capturePreservedAgentServiceTier,
	linkCachedPluginAgents,
} from "../../../../src/install/link-cached-plugin-agents.ts";
import { linkCachedPluginBins, linkRootRuntimeBin } from "../../../../src/install/codex-cache-bins.ts";
import { hasForeignAgentRegistration } from "../../../../src/install/codex-config-agents.ts";
import { updateCodexConfig } from "../../../../src/install/codex-config-toml.ts";
import { stampGitBashMcpEnv } from "../../../../src/install/codex-git-bash-mcp-env.ts";
import { trustedHookStatesForPlugin } from "../../../../src/install/codex-hook-trust.ts";
import { resolveCodexInstallerBinDir } from "../../../../src/install/codex-installer-bin-dir.ts";
import { prepareGitBashForInstall } from "../../../../src/install/git-bash.ts";
import type { CodexAgentConfig, GitBashResolution } from "../../../../src/install/types.ts";
import { appendBootstrapLog, BOOTSTRAP_DOCTOR_HINT } from "./worker.ts";
import type { BootstrapDegradedEntry, BootstrapStepOutcome } from "./worker.ts";

export const SETUP_MARKETPLACE_NAME = "sisyphuslabs";
export const SETUP_PLUGIN_NAME = "omo";
export const GIT_BASH_INSTALL_HINT = "winget install --id Git.Git -e --source winget";

export interface WorkerSetupOptions {
	readonly codexHome: string;
	readonly env: Record<string, string | undefined>;
	readonly pluginData: string;
	readonly pluginRoot: string;
	readonly platform: NodeJS.Platform;
	/** Timestamp used for bootstrap.log entries; the worker passes its run time. */
	readonly now?: number;
	/** Test seam: overrides Git Bash discovery (win32 only). */
	readonly resolveGitBash?: () => GitBashResolution;
}

interface AgentLinkOutcome {
	readonly agentConfigs: readonly CodexAgentConfig[];
	readonly degraded: readonly BootstrapDegradedEntry[];
}

// Worker setup sequence (every sub-step is idempotent and degraded-not-fatal,
// unlike the npx installer which throws): Git Bash preflight -> bundled agent
// TOML linking -> config blocks + hook trust re-stamp -> git_bash MCP env ->
// version-aware bin links. Bin linking re-runs whenever the worker re-runs,
// and the worker re-runs whenever completedForVersion changes (Task 7 marker
// semantics), so links always point at the CURRENT versioned PLUGIN_ROOT even
// though Codex deletes old version dirs on upgrade (core-plugins store.rs).
export async function runWorkerSetup(options: WorkerSetupOptions): Promise<BootstrapStepOutcome> {
	const degraded: BootstrapDegradedEntry[] = [];
	const gitBashEnabled = await resolveGitBashStep(options, degraded);
	const agents = await linkBundledAgentsStep(options);
	degraded.push(...agents.degraded);
	await updateConfigStep(options, { agentConfigs: agents.agentConfigs, gitBashEnabled }, degraded);
	await stampGitBashEnvStep(options, degraded);
	await linkComponentBinsStep(options, degraded);
	return { degraded };
}

async function resolveGitBashStep(options: WorkerSetupOptions, degraded: BootstrapDegradedEntry[]): Promise<boolean> {
	if (options.platform !== "win32") return false;
	try {
		const resolution = await prepareGitBashForInstall({
			env: options.env,
			platform: options.platform,
			...(options.resolveGitBash === undefined ? {} : { resolveGitBash: options.resolveGitBash }),
		});
		if (resolution.found) return true;
		degraded.push({
			component: "git-bash",
			hint: GIT_BASH_INSTALL_HINT,
			reason: "Git Bash was not found on this Windows machine; the omo git_bash MCP server stays disabled",
		});
	} catch (error) {
		degraded.push({
			component: "git-bash",
			hint: GIT_BASH_INSTALL_HINT,
			reason: `Git Bash preflight failed: ${errorMessage(error)}`,
		});
	}
	return false;
}

async function linkBundledAgentsStep(options: WorkerSetupOptions): Promise<AgentLinkOutcome> {
	const agentsTarget = join(options.codexHome, "agents");
	try {
		// linkCachedPluginAgents writes its .installed-agents.json manifest next
		// to the agent sources, so the bundled TOMLs are staged under PLUGIN_DATA
		// first: bootstrap must never persist anything under PLUGIN_ROOT (the
		// Codex-managed marketplace cache).
		const stageRoot = join(options.pluginData, "bootstrap", "agents-stage");
		await stageBundledAgents(options.pluginRoot, stageRoot);
		const preservedReasoning = await capturePreservedAgentReasoning({ codexHome: options.codexHome });
		const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome: options.codexHome });
		const linked = await linkCachedPluginAgents({
			codexHome: options.codexHome,
			pluginRoot: stageRoot,
			preservedReasoning,
			preservedServiceTier,
		});
		const agentConfigs = linked
			.map((link) => ({ configFile: `./agents/${link.name}`, name: agentNameFromToml(link.name) }))
			.sort((left, right) => left.name.localeCompare(right.name));
		return { agentConfigs, degraded: [] };
	} catch (error) {
		return {
			agentConfigs: [],
			degraded: [
				{
					component: "agents",
					hint: BOOTSTRAP_DOCTOR_HINT,
					reason: `failed to link bundled agents into ${agentsTarget}: ${errorMessage(error)}`,
				},
			],
		};
	}
}

async function stageBundledAgents(pluginRoot: string, stageRoot: string): Promise<void> {
	await rm(stageRoot, { force: true, recursive: true });
	await mkdir(stageRoot, { recursive: true });
	const componentsRoot = join(pluginRoot, "components");
	for (const componentName of await directoryNames(componentsRoot)) {
		const agentsDir = join(componentsRoot, componentName, "agents");
		const agentFiles = (await fileNames(agentsDir)).filter((name) => name.endsWith(".toml"));
		if (agentFiles.length === 0) continue;
		const stagedAgentsDir = join(stageRoot, "components", componentName, "agents");
		await mkdir(stagedAgentsDir, { recursive: true });
		for (const agentFile of agentFiles) {
			await copyFile(join(agentsDir, agentFile), join(stagedAgentsDir, agentFile));
		}
	}
}

async function updateConfigStep(
	options: WorkerSetupOptions,
	inputs: { agentConfigs: readonly CodexAgentConfig[]; gitBashEnabled: boolean },
	degraded: BootstrapDegradedEntry[],
): Promise<void> {
	const configPath = join(options.codexHome, "config.toml");
	try {
		await assertWritableConfigIfPresent(configPath);
		// Orca mirrors the system [agents.*] entries into its runtime CODEX_HOME
		// without copying the agents directory. Re-stamping our own registration
		// for such a role would collide with the mirrored entry once Codex
		// discovers <codexHome>/agents/<name>.toml (two different file paths for
		// one role name -> upstream warning), so foreign pre-existing blocks are
		// left untouched; directory discovery still loads the linked toml.
		const existingConfig = await readConfigIfPresent(configPath);
		const agentConfigs = inputs.agentConfigs.filter(
			(agentConfig) => !hasForeignAgentRegistration(existingConfig, agentConfig),
		);
		// Re-stamping trusted hook hashes after an upgrade is what makes the
		// next session's hooks trusted again once the user re-approved the
		// bootstrap hook itself.
		const trustedHookStates = await trustedHookStatesForPlugin({
			marketplaceName: SETUP_MARKETPLACE_NAME,
			pluginName: SETUP_PLUGIN_NAME,
			pluginRoot: options.pluginRoot,
		});
		await updateCodexConfig({
			agentConfigs,
			// Hard invariant: the bootstrap worker NEVER writes permission keys
			// (approval/sandbox/network policies stay installer-flag-only).
			autonomousPermissions: false,
			configPath,
			gitBashEnabled: inputs.gitBashEnabled,
			marketplaceName: SETUP_MARKETPLACE_NAME,
			marketplaceSource: { sourceType: "local", source: options.pluginRoot },
			platform: options.platform,
			pluginNames: [SETUP_PLUGIN_NAME],
			preserveMarketplaceSource: true,
			// The marketplace plugin tree has no <root>/plugin/model-catalog.json,
			// so updateCodexConfig falls back to the catalog bundled into this
			// dist; bootstrap-setup.test.mjs guards against drift between the two.
			repoRoot: options.pluginRoot,
			trustedHookStates,
		});
	} catch (error) {
		degraded.push({
			component: "config",
			hint: BOOTSTRAP_DOCTOR_HINT,
			reason: `failed to update ${configPath}: ${errorMessage(error)}`,
		});
	}
}

async function assertWritableConfigIfPresent(configPath: string): Promise<void> {
	try {
		if (((await stat(configPath)).mode & 0o222) === 0) throw new Error(`${configPath} has no write permission bits set`);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw error;
	}
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function readConfigIfPresent(configPath: string): Promise<string> {
	try {
		return await readFile(configPath, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return "";
		throw error;
	}
}

async function linkComponentBinsStep(options: WorkerSetupOptions, degraded: BootstrapDegradedEntry[]): Promise<void> {
	const binDir = resolveCodexInstallerBinDir({ codexHome: options.codexHome, env: options.env });
	try {
		await linkCachedPluginBins({ binDir, pluginRoot: options.pluginRoot, platform: options.platform });
	} catch (error) {
		degraded.push({
			component: "bin-links",
			hint: BOOTSTRAP_DOCTOR_HINT,
			reason: `failed to link component bins into ${binDir}: ${errorMessage(error)}`,
		});
	}
	await linkRuntimeWrapperStep(options, binDir, degraded);
}

// Older marketplace payloads may not have <pluginRoot>/dist/cli. Keep that
// degraded path explicit instead of leaving a broken `omo` link.
async function linkRuntimeWrapperStep(
	options: WorkerSetupOptions,
	binDir: string,
	degraded: BootstrapDegradedEntry[],
): Promise<void> {
	const cliPath = join(options.pluginRoot, "dist", "cli", "index.js");
	try {
		const linked = await linkRootRuntimeBin({
			binDir,
			codexHome: options.codexHome,
			platform: options.platform,
			repoRoot: options.pluginRoot,
		});
		if (linked !== null) return;
		degraded.push({
			component: "omo-cli",
			hint: "use npx lazycodex-ai for the omo CLI",
			reason: "marketplace payload has no dist/cli",
		});
		await appendBootstrapLog(options.pluginData, options.now ?? Date.now(), "omo-cli-degraded", {
			warning: `Warning: skipped the omo runtime wrapper because ${cliPath} is missing; omo ulw-loop commands will be unavailable until a package shipping dist/cli is installed`,
		});
	} catch (error) {
		degraded.push({
			component: "omo-cli",
			hint: BOOTSTRAP_DOCTOR_HINT,
			reason: `failed to link the omo runtime wrapper into ${binDir}: ${errorMessage(error)}`,
		});
	}
}

async function stampGitBashEnvStep(options: WorkerSetupOptions, degraded: BootstrapDegradedEntry[]): Promise<void> {
	try {
		await stampGitBashMcpEnv({ env: options.env, platform: options.platform, pluginRoot: options.pluginRoot });
	} catch (error) {
		degraded.push({
			component: "git-bash-env",
			hint: BOOTSTRAP_DOCTOR_HINT,
			reason: `failed to stamp ${join(options.pluginRoot, ".mcp.json")}: ${errorMessage(error)}`,
		});
	}
}

async function directoryNames(root: string): Promise<string[]> {
	return entryNames(root, (entry) => entry.isDirectory());
}

async function fileNames(root: string): Promise<string[]> {
	return entryNames(root, (entry) => entry.isFile());
}

async function entryNames(root: string, keep: (entry: { isDirectory(): boolean; isFile(): boolean }) => boolean): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => keep(entry))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
}

function agentNameFromToml(fileName: string): string {
	return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
