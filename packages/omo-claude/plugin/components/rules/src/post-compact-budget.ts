import type { PiRulesConfig } from "./rules/types.js";

export function withPostCompactBudget(config: PiRulesConfig): PiRulesConfig {
	return {
		...config,
		maxRuleChars: Math.min(config.maxRuleChars, config.postCompactMaxRuleChars),
		maxResultChars: Math.min(config.maxResultChars, config.postCompactMaxResultChars),
	};
}
