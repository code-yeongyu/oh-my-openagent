import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { configFromEnvironment } from "./config.js";
import { createEngine } from "@oh-my-opencode/rules-engine/engine";
import { findRuleCandidates } from "@oh-my-opencode/rules-engine/engine";
import { findProjectRoot } from "@oh-my-opencode/rules-engine/engine";

interface RulesEngineFactoryOptions {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}

const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function createRulesEngine(options: RulesEngineFactoryOptions, config = configFromEnvironment(options.env)) {
	const platform = options.platform ?? process.platform;
	const pluginRoot = options.env?.["PLUGIN_ROOT"] ?? process.env["PLUGIN_ROOT"] ?? componentRoot;

	return createEngine(config, {
		findCandidates: (finderOptions) => findRuleCandidates({ ...finderOptions, platform, pluginRoot }),
		findProjectRoot,
		readFile: (path) => {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return null;
			}
		},
	});
}
