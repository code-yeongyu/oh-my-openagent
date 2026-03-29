import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPluginConfig } from "../../../plugin-config";
import {
	getOpenCodeConfigPaths,
	getPluginConfigFileCandidates,
	readFirstValidPluginConfigFile,
} from "../../../shared";
import type { OmoConfig } from "./model-resolution-types";

const USER_CONFIG_DIR = getOpenCodeConfigPaths({
	binary: "opencode",
	version: null,
}).configDir;
const PROJECT_CONFIG_DIR = join(process.cwd(), ".opencode");

export function loadOmoConfig(): OmoConfig | null {
	const hasAnyConfig =
		getPluginConfigFileCandidates(PROJECT_CONFIG_DIR).some((path) => {
			try {
				readFileSync(path, "utf-8");
				return true;
			} catch {
				return false;
			}
		}) ||
		getPluginConfigFileCandidates(USER_CONFIG_DIR).some((path) => {
			try {
				readFileSync(path, "utf-8");
				return true;
			} catch {
				return false;
			}
		});

	if (!hasAnyConfig) return null;

	try {
		return loadPluginConfig(process.cwd(), {});
	} catch {
		const projectDetected =
			readFirstValidPluginConfigFile<OmoConfig>(PROJECT_CONFIG_DIR);
		if (projectDetected.format !== "none") {
			return projectDetected.data;
		}

		const userDetected =
			readFirstValidPluginConfigFile<OmoConfig>(USER_CONFIG_DIR);
		if (userDetected.format !== "none") {
			return userDetected.data;
		}

		return null;
	}
}
