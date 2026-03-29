import { join } from "node:path";
import {
	type OhMyOpenCodeConfig,
	OhMyOpenCodeConfigSchema,
} from "../../../config";
import { loadConfigFromPath, mergeConfigs } from "../../../plugin-config";
import {
	getOpenCodeConfigPaths,
	getPluginConfigFileCandidates,
} from "../../../shared";
import type { OmoConfig } from "./model-resolution-types";

function getUserConfigDir(): string {
	return getOpenCodeConfigPaths({
		binary: "opencode",
		version: null,
	}).configDir;
}

function getProjectConfigDir(): string {
	return join(process.cwd(), ".opencode");
}

function loadFirstRuntimeLikeConfig(
	directory: string,
): OhMyOpenCodeConfig | null {
	for (const candidatePath of getPluginConfigFileCandidates(directory)) {
		const loadedConfig = loadConfigFromPath(
			candidatePath,
			{},
			{ migrate: true, persistMigration: false },
		);
		if (loadedConfig) return loadedConfig;
	}

	return null;
}

export function loadOmoConfig(): OmoConfig | null {
	const userConfig = loadFirstRuntimeLikeConfig(getUserConfigDir());
	const projectConfig = loadFirstRuntimeLikeConfig(getProjectConfigDir());

	if (!userConfig && !projectConfig) return null;

	let config = userConfig ?? OhMyOpenCodeConfigSchema.parse({});
	if (projectConfig) {
		config = mergeConfigs(config, projectConfig);
	}

	return config;
}
