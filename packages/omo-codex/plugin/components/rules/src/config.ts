import { SOURCE_PRIORITY } from "./rules/constants.js";
import { defaultConfig } from "./rules/engine.js";
import type { PiRulesConfig, RuleSource } from "./rules/types.js";

const MODE_VALUES = new Set<PiRulesConfig["mode"]>(["static", "dynamic", "both", "off"]);

export function configFromEnvironment(env: NodeJS.ProcessEnv = process.env): PiRulesConfig {
	const config = defaultConfig();
	config.disabled = isTruthy(firstEnv(env, "CODEX_RULES_DISABLED", "PI_RULES_DISABLED"));
	config.mode = parseMode(firstEnv(env, "CODEX_RULES_MODE", "PI_RULES_MODE")) ?? config.mode;
	config.maxRuleChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RULE_CHARS", "PI_RULES_MAX_RULE_CHARS")) ??
		config.maxRuleChars;
	config.maxResultChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RESULT_CHARS", "PI_RULES_MAX_RESULT_CHARS")) ??
		config.maxResultChars;
	config.enabledSources = parseEnabledSources(
		firstEnv(env, "CODEX_RULES_ENABLED_SOURCES", "PI_RULES_ENABLED_SOURCES"),
	);
	return config;
}

function firstEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = env[name];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

function isTruthy(value: string | undefined): boolean {
	if (value === undefined) return false;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseMode(value: string | undefined): PiRulesConfig["mode"] | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	return MODE_VALUES.has(normalized as PiRulesConfig["mode"]) ? (normalized as PiRulesConfig["mode"]) : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseEnabledSources(value: string | undefined): RuleSource[] | "auto" {
	if (value === undefined || value.trim().toLowerCase() === "auto") {
		return "auto";
	}

	const validSources = new Set(SOURCE_PRIORITY.keys());
	const sources: RuleSource[] = [];
	for (const rawSource of value.split(",")) {
		const source = rawSource.trim();
		if (!validSources.has(source as RuleSource)) {
			continue;
		}
		sources.push(source as RuleSource);
	}
	return sources.length > 0 ? sources : "auto";
}
