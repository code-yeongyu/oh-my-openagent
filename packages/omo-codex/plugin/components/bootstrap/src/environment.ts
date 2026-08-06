import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { acquireLock, DEFAULT_LOCK_STALE_MS, resolveLockPath, resolveStatePath } from "../../../scripts/auto-update-state.mjs";

export type InstallFlow = "npx-local" | "marketplace" | "unknown";

export type ConfigSourceSignal = "npx-local" | "marketplace" | "unparsable";

export interface DetectInstallFlowOptions {
	readonly pluginRoot: string;
	readonly configToml?: string;
	readonly marketplaceName?: string;
}

export interface InstallFlowDetection {
	readonly flow: InstallFlow;
	readonly snapshotPresent: boolean;
	readonly configSource: string | undefined;
	readonly configSignal: ConfigSourceSignal | undefined;
	readonly reason: string;
}

export const INSTALL_SNAPSHOT_FILENAME = "lazycodex-install.json";

const DEFAULT_MARKETPLACE_NAME = "sisyphuslabs";
const MAX_CODEX_HOME_WALK_UP_LEVELS = 6;

export async function detectInstallFlowDetailed(options: DetectInstallFlowOptions): Promise<InstallFlowDetection> {
	const marketplaceName = options.marketplaceName ?? DEFAULT_MARKETPLACE_NAME;
	const snapshotPresent = await isFile(join(options.pluginRoot, INSTALL_SNAPSHOT_FILENAME));
	const snapshotSignal: InstallFlow = snapshotPresent ? "npx-local" : "marketplace";
	const snapshotReason = snapshotPresent
		? `${INSTALL_SNAPSHOT_FILENAME} present at plugin root (written only by the npx installer)`
		: `${INSTALL_SNAPSHOT_FILENAME} absent from plugin root`;
	const scan = options.configToml === undefined ? { kind: "absent" as const } : scanMarketplaceSource(options.configToml, marketplaceName);

	if (scan.kind === "absent") {
		return {
			configSignal: undefined,
			configSource: undefined,
			flow: snapshotSignal,
			reason: `${snapshotReason}; no [marketplaces.${marketplaceName}] source to cross-check`,
			snapshotPresent,
		};
	}
	if (scan.kind === "unparsable") {
		return {
			configSignal: "unparsable",
			configSource: undefined,
			flow: "unknown",
			reason: `${snapshotReason}; [marketplaces.${marketplaceName}] source value is unparsable`,
			snapshotPresent,
		};
	}
	const configSignal = classifyMarketplaceSource(scan.source);
	if (configSignal === "unparsable") {
		return {
			configSignal,
			configSource: scan.source,
			flow: "unknown",
			reason: `${snapshotReason}; marketplace source ${JSON.stringify(scan.source)} is neither a local absolute path nor a git URL`,
			snapshotPresent,
		};
	}
	if (configSignal !== snapshotSignal) {
		return {
			configSignal,
			configSource: scan.source,
			flow: "unknown",
			reason: `${snapshotReason}, but marketplace source ${JSON.stringify(scan.source)} indicates ${configSignal}; signals disagree`,
			snapshotPresent,
		};
	}
	return {
		configSignal,
		configSource: scan.source,
		flow: snapshotSignal,
		reason: `${snapshotReason}; marketplace source ${JSON.stringify(scan.source)} agrees`,
		snapshotPresent,
	};
}

export async function detectInstallFlow(options: DetectInstallFlowOptions): Promise<InstallFlow> {
	return (await detectInstallFlowDetailed(options)).flow;
}

export interface DetectInstallFlowFromEnvironmentOptions {
	readonly pluginRoot: string;
	readonly env: Record<string, string | undefined>;
	readonly marketplaceName?: string;
}

export async function detectInstallFlowFromEnvironment(
	options: DetectInstallFlowFromEnvironmentOptions,
): Promise<InstallFlowDetection> {
	const home = await resolveCodexHome({ env: options.env, pluginRoot: options.pluginRoot });
	const configToml = await readOptionalFile(join(home.path, "config.toml"));
	return detectInstallFlowDetailed({
		pluginRoot: options.pluginRoot,
		...(configToml === undefined ? {} : { configToml }),
		...(options.marketplaceName === undefined ? {} : { marketplaceName: options.marketplaceName }),
	});
}

export async function detectInstallFlowForTest(pluginRoot: string): Promise<InstallFlow> {
	const home = await resolveCodexHome({ env: {}, pluginRoot });
	const configToml = home.source === "walk-up" ? await readOptionalFile(join(home.path, "config.toml")) : undefined;
	return detectInstallFlow({ pluginRoot, ...(configToml === undefined ? {} : { configToml }) });
}

export type CodexHomeSource = "env" | "walk-up" | "default";

export interface CodexHomeResolution {
	readonly path: string;
	readonly source: CodexHomeSource;
}

export interface ResolveCodexHomeOptions {
	readonly env: Record<string, string | undefined>;
	readonly pluginRoot?: string;
}

export async function resolveCodexHome(options: ResolveCodexHomeOptions): Promise<CodexHomeResolution> {
	const envHome = options.env["CODEX_HOME"]?.trim();
	if (envHome !== undefined && envHome.length > 0) {
		return { path: resolve(envHome), source: "env" };
	}
	if (options.pluginRoot !== undefined) {
		let current = resolve(options.pluginRoot);
		for (let level = 0; level < MAX_CODEX_HOME_WALK_UP_LEVELS; level += 1) {
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
			if (await isFile(join(current, "config.toml"))) {
				return { path: current, source: "walk-up" };
			}
		}
	}
	return { path: join(homedir(), ".codex"), source: "default" };
}

export interface BootstrapLocksOptions {
	readonly pluginData: string;
	readonly env: Record<string, string | undefined>;
	readonly now?: number;
	readonly staleMs?: number;
}

export interface BootstrapLockHandle {
	readonly statePath: string;
	readonly bootstrapLockPath: string;
	readonly autoUpdateLockPath: string;
	readonly release: () => Promise<void>;
}

export function resolveBootstrapStatePath(pluginData: string): string {
	return join(pluginData, "bootstrap", "state.json");
}

export function resolveBootstrapLockPath(pluginData: string): string {
	return `${resolveBootstrapStatePath(pluginData)}.lock`;
}

export async function bootstrapLocks(options: BootstrapLocksOptions): Promise<BootstrapLockHandle | null> {
	const now = options.now ?? Date.now();
	const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
	const statePath = resolveBootstrapStatePath(options.pluginData);
	const bootstrapLockPath = resolveBootstrapLockPath(options.pluginData);
	const autoUpdateLockPath = resolveLockPath(options.env, resolveStatePath(options.env));

	const bootstrapLock = await acquireLock(bootstrapLockPath, now, staleMs);
	if (bootstrapLock === null) return null;
	if (autoUpdateLockPath === bootstrapLockPath) {
		return { autoUpdateLockPath, bootstrapLockPath, release: () => bootstrapLock.release(), statePath };
	}
	const autoUpdateLock = await acquireLock(autoUpdateLockPath, now, staleMs);
	if (autoUpdateLock === null) {
		await bootstrapLock.release();
		return null;
	}
	return {
		autoUpdateLockPath,
		bootstrapLockPath,
		release: async () => {
			await autoUpdateLock.release();
			await bootstrapLock.release();
		},
		statePath,
	};
}

type MarketplaceSourceScan = { readonly kind: "absent" } | { readonly kind: "unparsable" } | { readonly kind: "source"; readonly source: string };

function scanMarketplaceSource(configToml: string, marketplaceName: string): MarketplaceSourceScan {
	const expectedHeaders = new Set([`marketplaces.${marketplaceName}`, `marketplaces.${JSON.stringify(marketplaceName)}`]);
	let inMarketplaceSection = false;
	for (const line of configToml.split("\n")) {
		const header = parseTomlHeader(line);
		if (header !== null) {
			inMarketplaceSection = expectedHeaders.has(header);
			continue;
		}
		if (!inMarketplaceSection) continue;
		const valueText = parseSourceAssignment(line);
		if (valueText === null) continue;
		const source = parseTomlStringValue(valueText);
		return source === undefined ? { kind: "unparsable" } : { kind: "source", source };
	}
	return { kind: "absent" };
}

function parseTomlHeader(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
	if (trimmed.startsWith("[[")) return null;
	return trimmed.slice(1, -1).trim();
}

function parseSourceAssignment(line: string): string | null {
	const match = /^\s*source\s*=\s*(.+)$/.exec(line);
	return match === null ? null : (match[1] ?? null);
}

function parseTomlStringValue(valueText: string): string | undefined {
	const trimmed = valueText.trim();
	if (trimmed.startsWith('"')) return parseLeadingJsonString(trimmed);
	if (trimmed.startsWith("'")) {
		const closingIndex = trimmed.indexOf("'", 1);
		return closingIndex === -1 ? undefined : trimmed.slice(1, closingIndex);
	}
	return undefined;
}

function parseLeadingJsonString(value: string): string | undefined {
	let escaped = false;
	for (let index = 1; index < value.length; index += 1) {
		if (escaped) {
			escaped = false;
			continue;
		}
		const char = value[index];
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			try {
				const parsed: unknown = JSON.parse(value.slice(0, index + 1));
				return typeof parsed === "string" ? parsed : undefined;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

function classifyMarketplaceSource(source: string): ConfigSourceSignal {
	const trimmed = source.trim();
	if (trimmed.length === 0) return "unparsable";
	if (/^(https?|ssh|git):\/\//i.test(trimmed) || trimmed.startsWith("git@")) return "marketplace";
	if (trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
		return "npx-local";
	}
	if (trimmed.toLowerCase().endsWith(".git")) return "marketplace";
	return "unparsable";
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}
