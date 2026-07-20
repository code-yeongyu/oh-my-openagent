import { fileURLToPath } from "node:url";

import {
	sweepCodegraphZombies,
	type SweepCodegraphZombiesOptions,
} from "../../../../../utils/src/codegraph/process-sweep.ts";

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

function defaultPluginRoot(): string {
	return fileURLToPath(new URL("../../..", import.meta.url));
}
