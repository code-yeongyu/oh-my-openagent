import { describe, expect, test } from "bun:test";
import { createRuleInjectionProcessor as createRuleInjectionProcessorFromFacade } from "./injector";
import type { RuleInjectionProcessorDeps as RuleInjectionProcessorDepsFromFacade } from "./injector";
import { createRuleInjectionProcessor as createRuleInjectionProcessorFromProcessor } from "./injection-processor";
import type { RuleInjectionProcessorDeps as RuleInjectionProcessorDepsFromTypes } from "./injection-types";
import {
	clearParsedRuleCache as clearParsedRuleCacheFromCache,
	getParsedRuleCacheStats as getParsedRuleCacheStatsFromCache,
} from "./parsed-rule-cache";
import {
	clearParsedRuleCache as clearParsedRuleCacheFromFacade,
	getParsedRuleCacheStats as getParsedRuleCacheStatsFromFacade,
} from "./injector";

describe("rules injector facade", () => {
	test("#given the injector facade #when runtime exports are imported #then it preserves the existing module boundary", () => {
		const processorFactory = createRuleInjectionProcessorFromFacade;
		const clearCache = clearParsedRuleCacheFromFacade;
		const getCacheStats = getParsedRuleCacheStatsFromFacade;

		expect(processorFactory).toBe(createRuleInjectionProcessorFromProcessor);
		expect(clearCache).toBe(clearParsedRuleCacheFromCache);
		expect(getCacheStats).toBe(getParsedRuleCacheStatsFromCache);
	});

	test("#given the injector facade #when dependency types are imported #then they match the processor contract", () => {
		const dependencyContract: RuleInjectionProcessorDepsFromFacade = {
			workspaceDirectory: "/tmp/project",
			truncator: {
				truncate: async (_sessionID: string, content: string) => ({
					result: content,
					truncated: false,
				}),
			},
			getSessionCache: () => ({
				contentHashes: new Set<string>(),
				realPaths: new Set<string>(),
			}),
		};
		const acceptProcessorDeps = (
			deps: RuleInjectionProcessorDepsFromTypes,
		): RuleInjectionProcessorDepsFromTypes => deps;

		expect(acceptProcessorDeps(dependencyContract)).toBe(dependencyContract);
	});
});
