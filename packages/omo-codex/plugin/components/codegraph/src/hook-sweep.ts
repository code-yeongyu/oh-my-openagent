import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	sweepCodegraphZombies,
	type SweepCodegraphZombiesOptions,
} from "../../../../../utils/src/codegraph/process-sweep.ts";
import {
	sweepOrphanedLspDaemonProxies,
	sweepOrphanedGitBashProxies,
	sweepStaleLspDaemonVersions,
	isValidLspDaemonVersion,
	OMO_LSP_DAEMON_VERSION_ENV,
	type SweepOrphanedLspDaemonProxiesOptions,
	type SweepOrphanedGitBashProxiesOptions,
	type SweepStaleLspDaemonVersionsOptions,
} from "../../../../../utils/src/process-sweep/index.ts";

export interface OmoFamilySweeps {
	readonly sweepCodegraph: (options: SweepCodegraphZombiesOptions) => Promise<unknown> | unknown;
	readonly sweepGitBashProxies: (options: SweepOrphanedGitBashProxiesOptions) => Promise<unknown> | unknown;
	readonly sweepLspProxies: (options: SweepOrphanedLspDaemonProxiesOptions) => Promise<unknown> | unknown;
	readonly sweepStaleLspDaemons: (options: SweepStaleLspDaemonVersionsOptions) => Promise<unknown> | unknown;
}

const defaultFamilySweeps: OmoFamilySweeps = {
	sweepCodegraph: sweepCodegraphZombies,
	sweepGitBashProxies: sweepOrphanedGitBashProxies,
	sweepLspProxies: sweepOrphanedLspDaemonProxies,
	sweepStaleLspDaemons: sweepStaleLspDaemonVersions,
};

export async function sweepCodegraphZombiesBestEffort(
	options: Omit<SweepCodegraphZombiesOptions, "pluginRoot">,
	sweep: (options: SweepCodegraphZombiesOptions) => Promise<unknown> | unknown = sweepCodegraphZombies,
	pluginRoot: string = defaultPluginRoot(),
): Promise<void> {
	try {
		await sweep({
			...options,
			pluginRoot,
			...(options.log === undefined ? {} : { log: options.log }),
		});
	} catch (error) {
		options.log?.(`CodeGraph zombie sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function sweepOmoFamiliesBestEffort(
	options: Omit<SweepCodegraphZombiesOptions, "pluginRoot"> & { readonly pluginRoot?: string },
	sweeps: OmoFamilySweeps = defaultFamilySweeps,
): Promise<void> {
	const { pluginRoot: configuredPluginRoot, ...sharedOptions } = options;
	const pluginRoot = configuredPluginRoot ?? defaultPluginRoot();
	const versionResolution = resolveActiveLspDaemonVersion(sharedOptions.env, pluginRoot);
	const staleBaseOptions = versionResolution.kind === "invalid-override"
		? {
			...sharedOptions,
			env: { ...(sharedOptions.env ?? process.env), [OMO_LSP_DAEMON_VERSION_ENV]: undefined },
		}
		: sharedOptions;
	const staleSweepOptions = versionResolution.kind === "resolved" && versionResolution.version !== undefined
		? { ...staleBaseOptions, currentVersion: versionResolution.version }
		: staleBaseOptions;
	await Promise.all([
		sweepCodegraphZombiesBestEffort(sharedOptions, sweeps.sweepCodegraph, pluginRoot),
		sweepFamilyBestEffort("git-bash proxy sweep", sharedOptions, pluginRoot, (sweepOptions) => sweeps.sweepGitBashProxies(sweepOptions)),
		sweepFamilyBestEffort("lsp-daemon proxy sweep", sharedOptions, pluginRoot, (sweepOptions) => sweeps.sweepLspProxies(sweepOptions)),
		sweepFamilyBestEffort("lsp-daemon stale-version sweep", staleSweepOptions, pluginRoot, (sweepOptions) => sweeps.sweepStaleLspDaemons(sweepOptions)),
	]);
}

async function sweepFamilyBestEffort(
	familyLabel: string,
	options: Omit<SweepCodegraphZombiesOptions, "pluginRoot"> & { readonly currentVersion?: string },
	pluginRoot: string,
	sweep: (options: SweepCodegraphZombiesOptions & { readonly currentVersion?: string }) => Promise<unknown> | unknown,
): Promise<void> {
	try {
		await sweep({ ...options, pluginRoot });
	} catch (error) {
		options.log?.(`${familyLabel} skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

type ActiveLspDaemonVersionResolution =
	| { readonly kind: "invalid-override" }
	| { readonly kind: "resolved"; readonly version: string | undefined };

function resolveActiveLspDaemonVersion(
	env: NodeJS.ProcessEnv | undefined,
	pluginRoot: string,
): ActiveLspDaemonVersionResolution {
	const override = (env ?? process.env)[OMO_LSP_DAEMON_VERSION_ENV];
	if (override !== undefined) {
		return isValidLspDaemonVersion(override)
			? { kind: "resolved", version: override }
			: { kind: "invalid-override" };
	}
	return { kind: "resolved", version: readPackagedLspDaemonVersion(pluginRoot) };
}

function readPackagedLspDaemonVersion(pluginRoot: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(pluginRoot, "components", "lsp-daemon", "dist", "package.json"), "utf8"),
		);
		if (
			isRecord(parsed) &&
			parsed["name"] === "@code-yeongyu/lsp-daemon" &&
			typeof parsed["version"] === "string" &&
			isValidLspDaemonVersion(parsed["version"])
		) {
			return parsed["version"];
		}
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultPluginRoot(): string {
	return fileURLToPath(new URL("../../..", import.meta.url));
}
