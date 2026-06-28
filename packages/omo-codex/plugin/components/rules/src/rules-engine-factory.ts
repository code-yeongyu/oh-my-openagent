import { readFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { configFromEnvironment } from "./config.js";
import { disabledRuleIdsFromEnvironment } from "./config.js";
import { normalizeRuleId } from "./config.js";
import { createEngine } from "@oh-my-opencode/rules-engine/engine";
import { findRuleCandidates } from "@oh-my-opencode/rules-engine/engine";
import { findProjectRoot } from "@oh-my-opencode/rules-engine/engine";
import type { PiRulesConfig } from "@oh-my-opencode/rules-engine/engine";
import type { RuleCandidate } from "@oh-my-opencode/rules-engine/engine";

interface RulesEngineFactoryOptions {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}

const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function createRulesEngine(options: RulesEngineFactoryOptions, config: PiRulesConfig = configFromEnvironment(options.env)) {
	const platform = options.platform ?? process.platform;
	const pluginRoot = options.env?.["PLUGIN_ROOT"] ?? process.env["PLUGIN_ROOT"] ?? componentRoot;
	const disabledRuleIds = resolveDisabledRuleIds(config, options.env);

	return createEngine(config, {
		findCandidates: (finderOptions) =>
			findRuleCandidates({ ...finderOptions, platform, pluginRoot }).filter((candidate) =>
				isRuleCandidateEnabled(candidate, disabledRuleIds),
			),
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

function resolveDisabledRuleIds(config: PiRulesConfig, env: NodeJS.ProcessEnv | undefined): ReadonlySet<string> {
	if (hasDisabledRuleIds(config)) return config.disabledRuleIds;
	return disabledRuleIdsFromEnvironment(env);
}

function hasDisabledRuleIds(config: PiRulesConfig): config is PiRulesConfig & { readonly disabledRuleIds: ReadonlySet<string> } {
	return "disabledRuleIds" in config && config.disabledRuleIds instanceof Set;
}

function isRuleCandidateEnabled(candidate: RuleCandidate, disabledRuleIds: ReadonlySet<string>): boolean {
	return !disabledRuleIds.has(ruleIdForCandidate(candidate));
}

function ruleIdForCandidate(candidate: RuleCandidate): string {
	const extension = extname(candidate.relativePath.length > 0 ? candidate.relativePath : candidate.path);
	const fileName = basename(candidate.relativePath.length > 0 ? candidate.relativePath : candidate.path, extension);
	return normalizeRuleId(fileName);
}
