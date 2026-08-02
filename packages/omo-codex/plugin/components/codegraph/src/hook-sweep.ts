import { fileURLToPath } from "node:url";

import {
	sweepCodegraphZombies,
	type SweepCodegraphZombiesOptions,
} from "../../../../../utils/src/codegraph/process-sweep.ts";
import {
	sweepOrphanedLspDaemonProxies,
	sweepOrphanedGitBashProxies,
	sweepStaleLspDaemonVersions,
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
): Promise<void> {
	try {
		await sweep({
			...options,
			pluginRoot: defaultPluginRoot(),
			...(options.log === undefined ? {} : { log: options.log }),
		});
	} catch (error) {
		options.log?.(`CodeGraph zombie sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function sweepOmoFamiliesBestEffort(
	options: Omit<SweepCodegraphZombiesOptions, "pluginRoot">,
	sweeps: OmoFamilySweeps = defaultFamilySweeps,
): Promise<void> {
	await Promise.all([
		sweepCodegraphZombiesBestEffort(options, sweeps.sweepCodegraph),
		sweepFamilyBestEffort("git-bash proxy sweep", options, (sweepOptions) => sweeps.sweepGitBashProxies(sweepOptions)),
		sweepFamilyBestEffort("lsp-daemon proxy sweep", options, (sweepOptions) => sweeps.sweepLspProxies(sweepOptions)),
		sweepFamilyBestEffort("lsp-daemon stale-version sweep", options, (sweepOptions) => sweeps.sweepStaleLspDaemons(sweepOptions)),
	]);
}

async function sweepFamilyBestEffort(
	familyLabel: string,
	options: Omit<SweepCodegraphZombiesOptions, "pluginRoot">,
	sweep: (options: SweepCodegraphZombiesOptions) => Promise<unknown> | unknown,
): Promise<void> {
	try {
		await sweep({ ...options, pluginRoot: defaultPluginRoot() });
	} catch (error) {
		options.log?.(`${familyLabel} skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function defaultPluginRoot(): string {
	return fileURLToPath(new URL("../../..", import.meta.url));
}
