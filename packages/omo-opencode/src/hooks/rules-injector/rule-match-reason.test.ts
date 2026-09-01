import { describe, expect, test } from "bun:test";
import { createMatchDecisionCache } from "./match-decision-cache";
import { getRuleMatchReason } from "./rule-match-reason";
import type { RuleMetadata } from "./types";

const metadata: RuleMetadata = {};

describe("getRuleMatchReason", () => {
	test("#given a single-file rule #when resolving match reason #then it bypasses glob matching", () => {
		let matchCalls = 0;

		const matchReason = getRuleMatchReason({
			matchDecisionCache: createMatchDecisionCache(),
			isSingleFile: true,
			projectRoot: "/repo",
			resolved: "/repo/src/index.ts",
			realPath: "/repo/.github/copilot-instructions.md",
			statFingerprint: "100:20",
			metadata,
			shouldApplyRuleImpl: () => {
				matchCalls += 1;
				return { applies: true, reason: "matched" };
			},
		});

		expect(matchReason).toBe("copilot-instructions (always apply)");
		expect(matchCalls).toBe(0);
	});

	test("#given a cached rule decision #when resolving the same rule again #then it reuses the cached reason", () => {
		let matchCalls = 0;
		const matchDecisionCache = createMatchDecisionCache();
		const input = {
			matchDecisionCache,
			isSingleFile: false,
			projectRoot: "/repo",
			resolved: "/repo/src/index.ts",
			realPath: "/repo/.github/instructions/typescript.instructions.md",
			statFingerprint: "100:20",
			metadata,
			shouldApplyRuleImpl: () => {
				matchCalls += 1;
				return { applies: true, reason: "typescript rule" };
			},
		};

		const firstReason = getRuleMatchReason(input);
		const secondReason = getRuleMatchReason(input);

		expect(firstReason).toBe("typescript rule");
		expect(secondReason).toBe("typescript rule");
		expect(matchCalls).toBe(1);
	});
});
