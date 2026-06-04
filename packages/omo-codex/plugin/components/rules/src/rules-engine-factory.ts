import { readFileSync } from "node:fs";

import { configFromEnvironment } from "./config.js";
import { createEngine } from "./rules/engine.js";
import { findRuleCandidates } from "./rules/finder.js";
import { findProjectRoot } from "./rules/project-root.js";

interface RulesEngineFactoryOptions {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}

export function createRulesEngine(options: RulesEngineFactoryOptions, config = configFromEnvironment(options.env)) {
	const platform = options.platform ?? process.platform;

	return createEngine(config, {
		findCandidates: (finderOptions) => findRuleCandidates({ ...finderOptions, platform }),
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
