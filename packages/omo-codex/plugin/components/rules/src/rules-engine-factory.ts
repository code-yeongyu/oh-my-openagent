import { readFileSync } from "node:fs";

import { configFromEnvironment } from "./config.js";
import { createEngine } from "./rules/engine.js";
import { findRuleCandidates } from "./rules/finder.js";
import { findProjectRoot } from "./rules/project-root.js";

interface RulesEngineFactoryOptions {
	env?: NodeJS.ProcessEnv;
}

export function createRulesEngine(options: RulesEngineFactoryOptions, config = configFromEnvironment(options.env)) {
	return createEngine(config, {
		findCandidates: findRuleCandidates,
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
