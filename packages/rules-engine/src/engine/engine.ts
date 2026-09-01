import {
	clearSession,
	createSessionState,
	isDynamicInjected as isDynamicInjectedInState,
	isStaticInjected as isStaticInjectedInState,
	markDynamicInjected as markDynamicInjectedInState,
	markStaticInjected as markStaticInjectedInState,
} from "./cache.js";
import {
	DEFAULT_DYNAMIC_MAX_RESULT_CHARS,
	DEFAULT_DYNAMIC_MAX_RULE_CHARS,
	DEFAULT_MAX_RESULT_CHARS,
	DEFAULT_MAX_RULE_CHARS,
	DEFAULT_POST_COMPACT_MAX_RESULT_CHARS,
	DEFAULT_POST_COMPACT_MAX_RULE_CHARS,
	DEFAULT_PROMPT_MAX_RESULT_CHARS,
	DEFAULT_PROMPT_MAX_RULE_CHARS,
} from "./constants.js";
import { loadDynamicCandidates } from "./engine-dynamic-loader.js";
import { loadStaticCandidates } from "./engine-static-loader.js";
import type { DynamicMatchCache, Engine, EngineDeps } from "./engine-types.js";
import { formatDynamicBlock, formatStaticBlock } from "./formatter.js";
import { disabledSourcesFromConfig } from "./sources.js";
import type { LoadedRule, PiRulesConfig, RuleDiagnostic, SessionState } from "./types.js";

export type { Engine, EngineDeps } from "./engine-types.js";

export function defaultConfig(): PiRulesConfig {
	return {
		disabled: false,
		mode: "both",
		maxRuleChars: DEFAULT_MAX_RULE_CHARS,
		maxResultChars: DEFAULT_MAX_RESULT_CHARS,
		postCompactMaxRuleChars: DEFAULT_POST_COMPACT_MAX_RULE_CHARS,
		postCompactMaxResultChars: DEFAULT_POST_COMPACT_MAX_RESULT_CHARS,
		dynamicMaxRuleChars: DEFAULT_DYNAMIC_MAX_RULE_CHARS,
		dynamicMaxResultChars: DEFAULT_DYNAMIC_MAX_RESULT_CHARS,
		promptMaxRuleChars: DEFAULT_PROMPT_MAX_RULE_CHARS,
		promptMaxResultChars: DEFAULT_PROMPT_MAX_RESULT_CHARS,
		enabledSources: "auto",
	};
}

export function createEngine(config: PiRulesConfig, deps: EngineDeps): Engine {
	const state = createSessionState();
	const dynamicMatchCache: DynamicMatchCache = new Map();

	function loadStaticRules(cwd: string): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
		state.cwd = cwd;
		if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
			return emptyLoadResult(state);
		}

		const projectRoot = deps.findProjectRoot(cwd);
		const findOptions: Parameters<EngineDeps["findCandidates"]>[0] = {
			projectRoot,
			targetFile: null,
		};
		const disabledSources = disabledSourcesFromConfig(config);
		if (disabledSources !== undefined) {
			findOptions.disabledSources = disabledSources;
		}
		const candidates = deps.findCandidates(findOptions);
		const result = loadStaticCandidates(candidates, deps, projectRoot);
		storeLastLoad(state, result.rules, result.diagnostics);
		return result;
	}

	function loadDynamicRules(
		cwd: string,
		targetPaths: ReadonlyArray<string>,
	): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
		state.cwd = cwd;
		if (config.disabled || config.mode === "off" || config.mode === "static" || targetPaths.length === 0) {
			return emptyLoadResult(state);
		}

		const result = loadDynamicCandidates(config, deps, cwd, targetPaths, dynamicMatchCache);
		storeLastLoad(state, result.rules, result.diagnostics);
		return result;
	}

	return {
		state,
		config,
		loadStaticRules,
		loadDynamicRules,
		formatStatic: (rules) =>
			formatStaticBlock(rules, { maxRuleChars: config.maxRuleChars, maxResultChars: config.maxResultChars }),
		formatDynamic: (rules, target) =>
			formatDynamicBlock(rules, target, {
				maxRuleChars: config.maxRuleChars,
				maxResultChars: config.maxResultChars,
			}),
		resetSession: (cwd) => {
			clearSession(state);
			dynamicMatchCache.clear();
			if (cwd !== undefined) {
				state.cwd = cwd;
			}
		},
		isStaticInjected: (rule) => isStaticInjectedInState(state, rule),
		isDynamicInjected: (rule) => isDynamicInjectedInState(state, rule),
		markStaticInjected: (rule) => markStaticInjectedInState(state, rule),
		markDynamicInjected: (rule) => markDynamicInjectedInState(state, rule),
	};
}

function storeLastLoad(
	state: SessionState,
	rules: ReadonlyArray<LoadedRule>,
	diagnostics: ReadonlyArray<RuleDiagnostic>,
): void {
	state.loadedRules.length = 0;
	state.loadedRules.push(...rules);
	state.diagnostics.length = 0;
	state.diagnostics.push(...diagnostics);
}

function emptyLoadResult(state: SessionState): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
	storeLastLoad(state, [], []);
	return { rules: [], diagnostics: [] };
}
